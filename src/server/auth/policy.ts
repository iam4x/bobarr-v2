import { AppError } from "../core";

export type Rank = "admin" | "user";

export type Account = {
  id: number;
  username: string;
  rank: Rank;
  createdAt: string;
  lastLoginAt: string | null;
  uiLocale: "en" | "fr" | null;
};

export type Actor = {
  sessionId: string;
  account: Account;
};

export type ClientCapabilities = {
  rank: Rank;
  canManageSettings: boolean;
};

export function requireAdmin(
  actor: Actor,
  message = "Administrator access is required",
): void {
  if (actor.account.rank === "admin") return;
  throw new AppError({
    code: "forbidden",
    message,
    status: 403,
  });
}

export function requireOwner(
  actor: Actor,
  ownerId: number,
  message: string,
): void {
  if (actor.account.rank === "admin" || actor.account.id === ownerId) return;
  throw new AppError({
    code: "forbidden",
    message,
    status: 403,
  });
}

export function projectCapabilities(rank: Rank): ClientCapabilities {
  return {
    rank,
    canManageSettings: rank === "admin",
  };
}
