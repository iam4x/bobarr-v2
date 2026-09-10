export function canMutateOwned(
  rank: "admin" | "user" | undefined,
  ownedByMe: boolean | undefined,
): boolean {
  return rank === "admin" || ownedByMe === true;
}
