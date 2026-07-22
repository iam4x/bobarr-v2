import { isAbsolute, relative, resolve, sep } from "node:path";

const RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function isPathContained(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
}

export function resolveContainedPath(
  root: string,
  relativePath: string,
): string {
  if (
    !relativePath ||
    isAbsolute(relativePath) ||
    relativePath.includes("\0")
  ) {
    throw new TypeError(
      "Library destination must be a non-empty relative path",
    );
  }
  const destination = resolve(root, relativePath);
  if (!isPathContained(root, destination) || destination === resolve(root)) {
    throw new TypeError("Library destination escapes its configured root");
  }
  return destination;
}

export function sanitizePathSegment(value: string): string {
  let segment = replaceControlCharacters(
    value.normalize("NFKC").replace(/[<>:"/\\|?*]/g, " "),
  )
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  if (segment === "." || segment === ".." || RESERVED_NAMES.test(segment)) {
    segment = `_${segment}`;
  }
  if (!segment) segment = "Untitled";
  return [...segment].slice(0, 180).join("");
}

function replaceControlCharacters(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127 ? " " : character;
    })
    .join("");
}

export function movieLibraryPath(input: {
  title: string;
  year?: number | null;
  extension: string;
}): string {
  const title = sanitizePathSegment(input.title);
  const suffix = input.year ? ` (${input.year})` : "";
  const folder = `${title}${suffix}`;
  return `${folder}/${folder}${safeExtension(input.extension)}`;
}

export function episodeLibraryPath(input: {
  showTitle: string;
  showYear?: number | null;
  season: number;
  episode: number;
  endEpisode?: number | null;
  episodeTitle?: string | null;
  extension: string;
}): string {
  const showTitle = sanitizePathSegment(input.showTitle);
  const showFolder = `${showTitle}${input.showYear ? ` (${input.showYear})` : ""}`;
  const season = paddedNumber(input.season, "season");
  const episode = paddedNumber(input.episode, "episode");
  const endEpisode =
    input.endEpisode !== undefined &&
    input.endEpisode !== null &&
    input.endEpisode !== input.episode
      ? `-E${paddedNumber(input.endEpisode, "episode")}`
      : "";
  const episodeTitle = input.episodeTitle
    ? ` - ${sanitizePathSegment(input.episodeTitle)}`
    : "";
  return `${showFolder}/Season ${season}/${showTitle} - S${season}E${episode}${endEpisode}${episodeTitle}${safeExtension(input.extension)}`;
}

function paddedNumber(value: number, name: string): string {
  if (!Number.isSafeInteger(value) || value < 0 || value > 9999) {
    throw new TypeError(`${name} number is invalid`);
  }
  return String(value).padStart(2, "0");
}

function safeExtension(value: string): string {
  const extension = value.startsWith(".") ? value : `.${value}`;
  if (!/^\.[a-z\d]{1,10}$/i.test(extension)) {
    throw new TypeError("Media extension is invalid");
  }
  return extension.toLowerCase();
}
