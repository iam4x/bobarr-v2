import { AppError } from "../core";

export const BOOTSTRAP_ADMIN_ID = 1;

export type Rank = "admin" | "user";

export type Account = {
  id: number;
  username: string;
  rank: Rank;
  createdAt: string;
  lastLoginAt: string | null;
};

export type Actor = {
  sessionId: string;
  account: Account;
};

export type Action =
  | { type: "manage_settings" }
  | { type: "manage_users" }
  | { type: "invite" }
  | { type: "download" }
  | { type: "mutate_media"; ownerId: number }
  | { type: "mutate_download"; requesterId: number }
  | { type: "change_own_password"; targetId: number };

export type Decision = { ok: true } | { ok: false; reason: string };

export type ClientCapabilities = {
  rank: Rank;
  canManageSettings: boolean;
  canManageUsers: boolean;
  canInvite: boolean;
};

export function decide(actor: Actor, action: Action): Decision {
  if (actor.account.rank === "admin") return { ok: true };

  switch (action.type) {
    case "download":
      return { ok: true };
    case "change_own_password":
      return action.targetId === actor.account.id
        ? { ok: true }
        : {
            ok: false,
            reason: "You can only change your own password",
          };
    case "mutate_media":
      return action.ownerId === actor.account.id
        ? { ok: true }
        : {
            ok: false,
            reason: "You can only change titles you added",
          };
    case "mutate_download":
      return action.requesterId === actor.account.id
        ? { ok: true }
        : {
            ok: false,
            reason: "You can only change downloads you started",
          };
    case "manage_settings":
      return {
        ok: false,
        reason: "Administrator access is required to change settings",
      };
    case "manage_users":
      return {
        ok: false,
        reason: "Administrator access is required to manage people",
      };
    case "invite":
      return {
        ok: false,
        reason: "Administrator access is required to invite people",
      };
    default: {
      const _exhaustive: never = action;
      return {
        ok: false,
        reason: `Unsupported action: ${String(_exhaustive)}`,
      };
    }
  }
}

export function requireAllowed(actor: Actor, action: Action): void {
  const decision = decide(actor, action);
  if (decision.ok) return;
  throw new AppError({
    code: "forbidden",
    message: decision.reason,
    status: 403,
  });
}

export function projectCapabilities(rank: Rank): ClientCapabilities {
  const admin = rank === "admin";
  return {
    rank,
    canManageSettings: admin,
    canManageUsers: admin,
    canInvite: admin,
  };
}

export function effectiveMediaOwner(media: {
  createdByUserId: number;
}): number {
  return media.createdByUserId;
}

export function effectiveDownloadRequester(download: {
  requestedByUserId: number | null;
}): number {
  return download.requestedByUserId ?? BOOTSTRAP_ADMIN_ID;
}

export function classifyLibraryAdd(
  existing: { createdByUserId: number } | undefined,
): Action {
  if (existing === undefined) return { type: "download" };
  return { type: "mutate_media", ownerId: existing.createdByUserId };
}

export function requesterForAcquiredDownload(media: {
  createdByUserId: number;
}): number {
  return media.createdByUserId;
}
