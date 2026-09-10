import type { Clock } from "../core";
import type {
  AuthRepository,
  InviteRepository,
  InviteRow,
  UserRow,
} from "../db";
import type {
  AuthService,
  RequestMetadata,
  SessionGrant,
} from "./auth-service";
import type { PasswordHasher } from "./passwords";

import { requireAllowed, type Actor, type Rank } from "./policy";
import {
  AppError,
  conflict,
  createOpaqueToken,
  hashOpaqueToken,
  notFound,
  toIsoDate,
} from "../core";

export const DEFAULT_INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

export type InviteState =
  | {
      status: "open";
      tokenHash: string;
      createdBy: number;
      expiresAt: string;
    }
  | {
      status: "accepted";
      tokenHash: string;
      createdBy: number;
      acceptedBy: number;
      acceptedAt: string;
    }
  | {
      status: "revoked";
      tokenHash: string;
      createdBy: number;
      revokedAt: string;
    }
  | {
      status: "expired";
      tokenHash: string;
      createdBy: number;
      expiresAt: string;
    };

export function deriveInviteState(row: InviteRow, now: number): InviteState {
  if (row.acceptedAt !== null && row.acceptedBy !== null) {
    return {
      status: "accepted",
      tokenHash: row.tokenHash,
      createdBy: row.createdBy,
      acceptedBy: row.acceptedBy,
      acceptedAt: toIsoDate(row.acceptedAt),
    };
  }
  if (row.revokedAt !== null) {
    return {
      status: "revoked",
      tokenHash: row.tokenHash,
      createdBy: row.createdBy,
      revokedAt: toIsoDate(row.revokedAt),
    };
  }
  if (row.expiresAt <= now) {
    return {
      status: "expired",
      tokenHash: row.tokenHash,
      createdBy: row.createdBy,
      expiresAt: toIsoDate(row.expiresAt),
    };
  }
  return {
    status: "open",
    tokenHash: row.tokenHash,
    createdBy: row.createdBy,
    expiresAt: toIsoDate(row.expiresAt),
  };
}

export class InviteService {
  constructor(
    private readonly invites: InviteRepository,
    private readonly accounts: AuthRepository,
    private readonly auth: AuthService,
    private readonly passwordHasher: PasswordHasher,
    private readonly clock: Clock,
    private readonly transact: (work: () => UserRow) => UserRow,
  ) {}

  async create(
    actor: Actor,
    options: { expiresInSeconds?: number } = {},
  ): Promise<{ id: string; token: string; expiresAt: string }> {
    requireAllowed(actor, { type: "invite" });
    const now = this.clock.now().getTime();
    const expiresInSeconds =
      options.expiresInSeconds ?? DEFAULT_INVITE_TTL_SECONDS;
    const token = createOpaqueToken();
    const row = this.invites.insertOpen({
      id: crypto.randomUUID(),
      tokenHash: hashOpaqueToken(token),
      createdBy: actor.account.id,
      createdAt: now,
      expiresAt: now + expiresInSeconds * 1000,
    });
    return {
      id: row.id,
      token,
      expiresAt: toIsoDate(row.expiresAt),
    };
  }

  preview(token: string): { status: "open"; expiresAt: string } {
    const row = this.invites.getByTokenHash(hashOpaqueToken(token));
    if (row === undefined) throw notFound("Invite not found");
    const state = deriveInviteState(row, this.clock.now().getTime());
    if (state.status === "open") {
      return { status: "open", expiresAt: state.expiresAt };
    }
    if (state.status === "accepted") {
      throw conflict("This invite has already been used");
    }
    throw notFound("Invite not found");
  }

  async accept(
    input: { token: string; username: string; password: string },
    metadata: RequestMetadata = {},
  ): Promise<SessionGrant> {
    const tokenHash = hashOpaqueToken(input.token);
    const existing = this.invites.getByTokenHash(tokenHash);
    if (existing === undefined) throw notFound("Invite not found");
    const now = this.clock.now().getTime();
    const state = deriveInviteState(existing, now);
    if (state.status === "accepted") {
      throw conflict("This invite has already been used");
    }
    if (state.status !== "open") throw notFound("Invite not found");

    const passwordHash = await this.passwordHasher.hash(input.password);
    this.transact(() => {
      const created = this.accounts.createUser(
        input.username,
        passwordHash,
        now,
      );
      const accepted = this.invites.acceptIfOpen({
        tokenHash,
        acceptedBy: created.id,
        now,
      });
      if (accepted === undefined) {
        throw conflict("This invite has already been used");
      }
      return created;
    });
    return this.auth.login(
      { username: input.username, password: input.password },
      metadata,
    );
  }

  revoke(actor: Actor, id: string): void {
    requireAllowed(actor, { type: "manage_users" });
    const row = this.invites.getById(id);
    if (row === undefined) throw notFound("Invite not found");
    const state = deriveInviteState(row, this.clock.now().getTime());
    if (state.status !== "open") {
      throw conflict("Only unused invites can be revoked");
    }
    if (!this.invites.revokeIfOpen(id, this.clock.now().getTime())) {
      throw conflict("Only unused invites can be revoked");
    }
  }

  setRank(actor: Actor, id: number, rank: Rank): UserRow {
    requireAllowed(actor, { type: "manage_users" });
    const target = this.accounts.getById(id);
    if (target === undefined) throw notFound("Account not found");
    if (target.rank === rank) return target;
    if (
      target.rank === "admin" &&
      rank === "user" &&
      this.accounts.countByRank("admin") <= 1
    ) {
      throw new AppError({
        code: "conflict",
        message: "The last administrator cannot be demoted",
        status: 409,
      });
    }
    return this.accounts.setRank(id, rank, this.clock.now().getTime());
  }

  deleteUser(actor: Actor, id: number): void {
    requireAllowed(actor, { type: "manage_users" });
    const target = this.accounts.getById(id);
    if (target === undefined) throw notFound("Account not found");
    if (target.rank === "admin" && this.accounts.countByRank("admin") <= 1) {
      throw new AppError({
        code: "conflict",
        message: "The last administrator cannot be deleted",
        status: 409,
      });
    }
    this.accounts.deleteUser(id);
  }

  list(actor: Actor): {
    users: ReturnType<AuthRepository["listUsers"]>;
    invites: InviteRow[];
  } {
    requireAllowed(actor, { type: "manage_users" });
    return {
      users: this.accounts.listUsers(),
      invites: this.invites.listAll(),
    };
  }
}
