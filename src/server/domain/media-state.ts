import type { AcquisitionState, LibraryItem } from "../../contracts";

export function aggregateChildAcquisitionState(
  children: readonly Pick<LibraryItem, "acquisitionState" | "monitorPolicy">[],
): AcquisitionState {
  const states = children
    .filter((child) => child.monitorPolicy !== "none")
    .map((child) => child.acquisitionState);
  if (states.length === 0) return "unmonitored";
  for (const active of [
    "organizing",
    "downloading",
    "searching",
    "queued",
  ] as const) {
    if (states.includes(active)) return active;
  }
  if (states.every((state) => state === "available")) return "available";
  if (states.includes("failed")) return "failed";
  if (states.includes("missing")) return "missing";
  return states[0] ?? "missing";
}

export function organizedEpisodeNumbers(
  sourcePaths: readonly string[],
  seasonNumber: number | null,
): ReadonlySet<number> {
  const episodes = new Set<number>();
  for (const sourcePath of sourcePaths) {
    const seasonMatch = /s(\d{1,2})/i.exec(sourcePath);
    if (
      seasonNumber !== null &&
      seasonMatch &&
      Number(seasonMatch[1]) !== seasonNumber
    ) {
      continue;
    }
    for (const match of sourcePath.matchAll(/e(\d{1,3})/gi)) {
      const episode = Number(match[1]);
      if (Number.isSafeInteger(episode) && episode > 0) episodes.add(episode);
    }
  }
  return episodes;
}
