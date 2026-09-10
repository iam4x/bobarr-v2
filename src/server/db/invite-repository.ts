import type { BackendDatabase } from "./database";

import { and, desc, eq, gte, isNull } from "drizzle-orm";

import { invites } from "./schema";

export type InviteRow = typeof invites.$inferSelect;

export class InviteRepository {
  constructor(private readonly database: BackendDatabase) {}

  insertOpen(input: {
    id: string;
    tokenHash: string;
    createdBy: number;
    createdAt: number;
    expiresAt: number;
  }): InviteRow {
    return this.database.client.insert(invites).values(input).returning().get();
  }

  getById(id: string): InviteRow | undefined {
    return this.database.client
      .select()
      .from(invites)
      .where(eq(invites.id, id))
      .get();
  }

  getByTokenHash(tokenHash: string): InviteRow | undefined {
    return this.database.client
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, tokenHash))
      .get();
  }

  listAll(): InviteRow[] {
    return this.database.client
      .select()
      .from(invites)
      .orderBy(desc(invites.createdAt))
      .all();
  }

  acceptIfOpen(input: {
    tokenHash: string;
    acceptedBy: number;
    now: number;
  }): { createdBy: number } | undefined {
    const row = this.database.client
      .update(invites)
      .set({
        acceptedBy: input.acceptedBy,
        acceptedAt: input.now,
      })
      .where(
        and(
          eq(invites.tokenHash, input.tokenHash),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
          gte(invites.expiresAt, input.now),
        ),
      )
      .returning({ createdBy: invites.createdBy })
      .get();
    return row;
  }

  revokeIfOpen(id: string, now: number): boolean {
    const row = this.database.client
      .update(invites)
      .set({ revokedAt: now })
      .where(
        and(
          eq(invites.id, id),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
        ),
      )
      .returning({ id: invites.id })
      .get();
    return row !== undefined;
  }
}
