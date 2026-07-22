export type ReleaseKind = "movie" | "season" | "episode";
export type ReleaseQuality = "2160p" | "1080p" | "720p" | "480p" | "unknown";
export type ReleaseSource =
  | "remux"
  | "bluray"
  | "web-dl"
  | "webrip"
  | "hdtv"
  | "dvd"
  | "telesync"
  | "cam"
  | "unknown";
export type ReleaseCodec =
  | "av1"
  | "x265"
  | "x264"
  | "mpeg4"
  | "xvid"
  | "unknown";
export type ReleaseHdr = "dolby-vision" | "hdr10+" | "hdr" | "sdr" | "unknown";

export interface ReleaseCandidate {
  id: string;
  title: string;
  sizeBytes: number;
  seeders: number;
  peers?: number;
  publishedAt?: string | null;
  indexer?: string | null;
}

export interface ReleaseTarget {
  kind: ReleaseKind;
  title: string;
  alternateTitles?: readonly string[];
  year?: number;
  season?: number;
  episode?: number;
  /** ISO release/air timestamp. Candidates are ineligible before this time. */
  releaseDate?: string | null;
}

export interface ReleaseProfile {
  minimumSeeders?: number;
  minimumSizeBytes?: number;
  maximumSizeBytes?: number;
  allowedQualities?: readonly ReleaseQuality[];
  qualityOrder?: readonly ReleaseQuality[];
  sourceOrder?: readonly ReleaseSource[];
  allowedCodecs?: readonly ReleaseCodec[];
  blockedIndexers?: readonly string[];
  requiredTerms?: readonly string[];
  excludedTerms?: readonly string[];
  preferredTerms?: Readonly<Record<string, number>>;
  indexerWeights?: Readonly<Record<string, number>>;
  rejectSamples?: boolean;
  rejectPassworded?: boolean;
  /** Evaluation clock supplied by the acquisition service for deterministic scoring. */
  now?: number;
}

export interface ReleaseFacts {
  normalizedTitle: string;
  tokens: readonly string[];
  quality: ReleaseQuality;
  source: ReleaseSource;
  codec: ReleaseCodec;
  hdr: ReleaseHdr;
  audio: readonly string[];
  releaseGroup: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
  proper: boolean;
  repack: boolean;
  sample: boolean;
  passworded: boolean;
}

export interface ScoredRelease<T extends ReleaseCandidate = ReleaseCandidate> {
  candidate: T;
  facts: ReleaseFacts;
  eligible: boolean;
  score: number;
  reasons: readonly string[];
  exclusions: readonly string[];
}

const DEFAULT_QUALITY_ORDER: readonly ReleaseQuality[] = [
  "1080p",
  "2160p",
  "720p",
  "480p",
  "unknown",
];
const DEFAULT_SOURCE_ORDER: readonly ReleaseSource[] = [
  "remux",
  "bluray",
  "web-dl",
  "webrip",
  "hdtv",
  "dvd",
  "unknown",
  "telesync",
  "cam",
];

export function normalizeReleaseTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z\d]+/gi, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function inspectRelease(title: string): ReleaseFacts {
  const normalizedTitle = normalizeReleaseTitle(title);
  const tokens = normalizedTitle ? normalizedTitle.split(" ") : [];
  const lower = title.toLowerCase();
  const episode = parseEpisodeIdentity(title);
  const yearMatches = [...title.matchAll(/(?:^|[^\d])((?:19|20)\d{2})(?!\d)/g)];
  const releaseYear = yearMatches.at(-1)?.[1];

  return {
    normalizedTitle,
    tokens,
    quality: detectQuality(lower),
    source: detectSource(lower),
    codec: detectCodec(lower),
    hdr: detectHdr(title),
    audio: detectAudio(title),
    releaseGroup: detectReleaseGroup(title),
    year: releaseYear ? Number(releaseYear) : null,
    season: episode.season,
    episode: episode.episode,
    proper: hasToken(tokens, "proper"),
    repack: hasToken(tokens, "repack") || /\brerip\b/i.test(title),
    sample: /(?:^|[. _-])sample(?:[. _-]|$)/i.test(title),
    passworded: /\b(?:password(?:ed)?|pwd|encrypted)\b/i.test(title),
  };
}

export function scoreRelease<T extends ReleaseCandidate>(
  candidate: T,
  target: ReleaseTarget,
  profile: ReleaseProfile = {},
): ScoredRelease<T> {
  validateTarget(target);
  validateCandidate(candidate);
  const facts = inspectRelease(candidate.title);
  const reasons: string[] = [];
  const exclusions: string[] = [];
  let score = 100;

  const titleMatch = matchTargetTitle(facts.tokens, target);
  if (!titleMatch.matched) {
    exclusions.push("release title does not match the requested media");
  } else {
    score += Math.round(titleMatch.coverage * 30);
    reasons.push(`title match +${Math.round(titleMatch.coverage * 30)}`);
  }

  applyIdentityRules(facts, target, exclusions, reasons, (points) => {
    score += points;
  });
  applyAvailabilityRule(target, profile.now ?? Date.now(), exclusions);

  const minimumSeeders = profile.minimumSeeders ?? 1;
  if (candidate.seeders < minimumSeeders) {
    exclusions.push(`requires at least ${minimumSeeders} seeders`);
  } else {
    const points = Math.min(
      30,
      Math.round(Math.log2(candidate.seeders + 1) * 4),
    );
    score += points;
    reasons.push(`swarm health +${points}`);
  }
  if (
    profile.minimumSizeBytes !== undefined &&
    candidate.sizeBytes < profile.minimumSizeBytes
  ) {
    exclusions.push("release is smaller than the configured minimum");
  }
  if (
    profile.maximumSizeBytes !== undefined &&
    candidate.sizeBytes > profile.maximumSizeBytes
  ) {
    exclusions.push("release exceeds the configured size limit");
  }

  if (
    profile.allowedQualities &&
    !profile.allowedQualities.includes(facts.quality)
  ) {
    exclusions.push(`quality ${facts.quality} is not allowed`);
  } else {
    const qualityPoints = preferencePoints(
      facts.quality,
      profile.qualityOrder ?? DEFAULT_QUALITY_ORDER,
      30,
    );
    score += qualityPoints;
    reasons.push(`quality ${facts.quality} +${qualityPoints}`);
  }

  const sourcePoints = preferencePoints(
    facts.source,
    profile.sourceOrder ?? DEFAULT_SOURCE_ORDER,
    10,
  );
  score += sourcePoints;
  reasons.push(`source ${facts.source} +${sourcePoints}`);

  if (profile.allowedCodecs && !profile.allowedCodecs.includes(facts.codec)) {
    exclusions.push(`codec ${facts.codec} is not allowed`);
  }
  const normalizedIndexer = normalizeReleaseTitle(candidate.indexer ?? "");
  const blockedIndexers = new Set(
    (profile.blockedIndexers ?? []).map(normalizeReleaseTitle),
  );
  if (normalizedIndexer && blockedIndexers.has(normalizedIndexer)) {
    exclusions.push("indexer is blocked");
  }

  applyTermRules(facts, profile, exclusions, reasons, (points) => {
    score += points;
  });
  if (profile.rejectSamples !== false && facts.sample) {
    exclusions.push("sample releases are excluded");
  }
  if (profile.rejectPassworded !== false && facts.passworded) {
    exclusions.push("password-protected releases are excluded");
  }
  if (facts.proper) {
    score += 4;
    reasons.push("proper +4");
  }
  if (facts.repack) {
    score += 6;
    reasons.push("repack +6");
  }
  const indexerWeight = findNormalizedWeight(
    profile.indexerWeights,
    candidate.indexer ?? "",
  );
  if (indexerWeight !== 0) {
    score += indexerWeight;
    reasons.push(`indexer ${signed(indexerWeight)}`);
  }

  return {
    candidate,
    facts,
    eligible: exclusions.length === 0,
    score: exclusions.length === 0 ? score : Number.NEGATIVE_INFINITY,
    reasons,
    exclusions,
  };
}

function applyAvailabilityRule(
  target: ReleaseTarget,
  now: number,
  exclusions: string[],
): void {
  if (target.releaseDate === undefined || target.releaseDate === null) return;
  const releaseAt = Date.parse(target.releaseDate);
  if (!Number.isFinite(releaseAt)) {
    throw new TypeError("Release target date must be a valid ISO date");
  }
  if (!Number.isFinite(now)) {
    throw new TypeError("Release profile clock must be a finite timestamp");
  }
  if (releaseAt > now) {
    exclusions.push(
      `media is not released until ${new Date(releaseAt).toISOString()}`,
    );
  }
}

export function rankReleases<T extends ReleaseCandidate>(
  candidates: readonly T[],
  target: ReleaseTarget,
  profile: ReleaseProfile = {},
): readonly ScoredRelease<T>[] {
  return candidates
    .map((candidate) => scoreRelease(candidate, target, profile))
    .sort(compareScoredReleases);
}

export function selectBestRelease<T extends ReleaseCandidate>(
  candidates: readonly T[],
  target: ReleaseTarget,
  profile: ReleaseProfile = {},
): ScoredRelease<T> | null {
  return (
    rankReleases(candidates, target, profile).find(
      (result) => result.eligible,
    ) ?? null
  );
}

function compareScoredReleases<T extends ReleaseCandidate>(
  left: ScoredRelease<T>,
  right: ScoredRelease<T>,
): number {
  if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
  if (left.score !== right.score) return right.score - left.score;
  if (left.candidate.seeders !== right.candidate.seeders) {
    return right.candidate.seeders - left.candidate.seeders;
  }
  const leftTime = Date.parse(left.candidate.publishedAt ?? "") || 0;
  const rightTime = Date.parse(right.candidate.publishedAt ?? "") || 0;
  if (leftTime !== rightTime) return rightTime - leftTime;
  if (left.candidate.sizeBytes !== right.candidate.sizeBytes) {
    return left.candidate.sizeBytes - right.candidate.sizeBytes;
  }
  return left.candidate.id.localeCompare(right.candidate.id);
}

function applyIdentityRules(
  facts: ReleaseFacts,
  target: ReleaseTarget,
  exclusions: string[],
  reasons: string[],
  add: (points: number) => void,
): void {
  if (target.year !== undefined && facts.year !== null) {
    if (facts.year !== target.year) {
      exclusions.push(
        `release year ${facts.year} does not match ${target.year}`,
      );
    } else {
      add(12);
      reasons.push("year match +12");
    }
  }
  if (target.kind === "movie") {
    if (facts.season !== null || facts.episode !== null) {
      exclusions.push("movie release contains a TV episode marker");
    }
    return;
  }
  if (target.season === undefined) {
    throw new TypeError("TV release targets require a season number");
  }
  if (facts.season === null) {
    exclusions.push("release does not contain a season marker");
  } else if (facts.season !== target.season) {
    exclusions.push(
      `release season ${facts.season} does not match ${target.season}`,
    );
  } else {
    add(18);
    reasons.push("season match +18");
  }
  if (target.kind === "episode") {
    if (target.episode === undefined) {
      throw new TypeError("Episode targets require an episode number");
    }
    if (facts.episode === null) {
      exclusions.push("release does not contain an episode marker");
    } else if (facts.episode !== target.episode) {
      exclusions.push(
        `release episode ${facts.episode} does not match ${target.episode}`,
      );
    } else {
      add(18);
      reasons.push("episode match +18");
    }
  } else if (facts.episode !== null) {
    exclusions.push("season pack target matched a single-episode release");
  }
}

function applyTermRules(
  facts: ReleaseFacts,
  profile: ReleaseProfile,
  exclusions: string[],
  reasons: string[],
  add: (points: number) => void,
): void {
  for (const term of profile.requiredTerms ?? []) {
    if (!containsNormalizedTerm(facts.normalizedTitle, term)) {
      exclusions.push(`required term missing: ${term}`);
    }
  }
  for (const term of profile.excludedTerms ?? []) {
    if (containsNormalizedTerm(facts.normalizedTitle, term)) {
      exclusions.push(`excluded term present: ${term}`);
    }
  }
  for (const [term, weight] of Object.entries(profile.preferredTerms ?? {})) {
    if (containsNormalizedTerm(facts.normalizedTitle, term)) {
      add(weight);
      reasons.push(`preferred ${term} ${signed(weight)}`);
    }
  }
}

function matchTargetTitle(
  releaseTokens: readonly string[],
  target: ReleaseTarget,
): { matched: boolean; coverage: number } {
  const alternatives = [target.title, ...(target.alternateTitles ?? [])];
  let bestCoverage = 0;
  for (const alternative of alternatives) {
    const tokens = normalizeReleaseTitle(alternative)
      .split(" ")
      .filter(Boolean);
    if (tokens.length === 0) continue;
    const matching = tokens.filter((token) =>
      releaseTokens.includes(token),
    ).length;
    const coverage = matching / tokens.length;
    if (coverage > bestCoverage) bestCoverage = coverage;
    if (coverage === 1 && containsSequence(releaseTokens, tokens)) {
      return { matched: true, coverage: 1 };
    }
  }
  return { matched: bestCoverage === 1, coverage: bestCoverage };
}

function containsSequence(
  haystack: readonly string[],
  needle: readonly string[],
): boolean {
  if (needle.length > haystack.length) return false;
  for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    if (needle.every((token, index) => haystack[offset + index] === token)) {
      return true;
    }
  }
  return false;
}

function parseEpisodeIdentity(title: string): {
  season: number | null;
  episode: number | null;
} {
  const compact = /(?:^|\D)s(\d{1,3})(?:[ ._-]*e(\d{1,4}))?(?!\d)/i.exec(title);
  if (compact?.[1]) {
    return {
      season: Number(compact[1]),
      episode: compact[2] ? Number(compact[2]) : null,
    };
  }
  const cross = /(?:^|\D)(\d{1,3})x(\d{1,4})(?!\d)/i.exec(title);
  if (cross?.[1] && cross[2]) {
    return { season: Number(cross[1]), episode: Number(cross[2]) };
  }
  const seasonWord = /\bseason[ ._-]*(\d{1,3})\b/i.exec(title);
  return {
    season: seasonWord?.[1] ? Number(seasonWord[1]) : null,
    episode: null,
  };
}

function detectQuality(title: string): ReleaseQuality {
  if (/\b(?:2160p|4k|uhd)\b/i.test(title)) return "2160p";
  if (/\b1080[pi]\b/i.test(title)) return "1080p";
  if (/\b720[pi]\b/i.test(title)) return "720p";
  if (/\b(?:480[pi]|576[pi]|sd)\b/i.test(title)) return "480p";
  return "unknown";
}

function detectSource(title: string): ReleaseSource {
  if (/\b(?:blu[ ._-]?ray|b[dr]remux).*\bremux\b|\bremux\b/i.test(title)) {
    return "remux";
  }
  if (/\b(?:blu[ ._-]?ray|b[dr]rip)\b/i.test(title)) return "bluray";
  if (/\bweb[ ._-]?dl\b|\bwebdl\b/i.test(title)) return "web-dl";
  if (/\bweb[ ._-]?rip\b|\bwebrip\b/i.test(title)) return "webrip";
  if (/\bhdtv\b/i.test(title)) return "hdtv";
  if (/\b(?:dvd|dvdrip)\b/i.test(title)) return "dvd";
  if (/\b(?:telesync|hdts|ts)\b/i.test(title)) return "telesync";
  if (/\b(?:cam|hdcam)\b/i.test(title)) return "cam";
  return "unknown";
}

function detectCodec(title: string): ReleaseCodec {
  if (/\bav1\b/i.test(title)) return "av1";
  if (/\b(?:x265|h[ ._-]?265|hevc)\b/i.test(title)) return "x265";
  if (/\b(?:x264|h[ ._-]?264|avc)\b/i.test(title)) return "x264";
  if (/\b(?:mpeg[ ._-]?4|divx)\b/i.test(title)) return "mpeg4";
  if (/\bxvid\b/i.test(title)) return "xvid";
  return "unknown";
}

function detectHdr(title: string): ReleaseHdr {
  if (/\b(?:dolby[ ._-]?vision|dovi|dv)\b/i.test(title)) return "dolby-vision";
  if (/\bhdr10\+\b/i.test(title)) return "hdr10+";
  if (/\b(?:hdr10|hdr)\b/i.test(title)) return "hdr";
  if (/\bsdr\b/i.test(title)) return "sdr";
  return "unknown";
}

function detectAudio(title: string): readonly string[] {
  const formats: [RegExp, string][] = [
    [/\batmos\b/i, "atmos"],
    [/\btrue[ ._-]?hd\b/i, "truehd"],
    [/\bdts[ ._-]?hd(?:[ ._-]?ma)?\b/i, "dts-hd"],
    [/\bdts\b/i, "dts"],
    [/\b(?:ddp|eac3|dd\+)\b/i, "eac3"],
    [/\b(?:ac3|dd)\b/i, "ac3"],
    [/\baac\b/i, "aac"],
  ];
  return formats.flatMap(([pattern, name]) =>
    pattern.test(title) ? [name] : [],
  );
}

function detectReleaseGroup(title: string): string | null {
  const match = /-([a-z\d][a-z\d._-]{1,31})\s*$/i.exec(title);
  return match?.[1] ?? null;
}

function preferencePoints<T>(
  value: T,
  order: readonly T[],
  step: number,
): number {
  const index = order.indexOf(value);
  return index < 0 ? 0 : Math.max(0, (order.length - index - 1) * step);
}

function containsNormalizedTerm(
  normalizedTitle: string,
  term: string,
): boolean {
  const normalizedTerm = normalizeReleaseTitle(term);
  if (!normalizedTerm) return false;
  return ` ${normalizedTitle} `.includes(` ${normalizedTerm} `);
}

function findNormalizedWeight(
  weights: Readonly<Record<string, number>> | undefined,
  key: string,
): number {
  const normalizedKey = normalizeReleaseTitle(key);
  for (const [candidate, weight] of Object.entries(weights ?? {})) {
    if (normalizeReleaseTitle(candidate) === normalizedKey) return weight;
  }
  return 0;
}

function hasToken(tokens: readonly string[], token: string): boolean {
  return tokens.includes(token);
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

function validateTarget(target: ReleaseTarget): void {
  if (!target.title.trim())
    throw new TypeError("Release target title is required");
  if (target.year !== undefined && !Number.isSafeInteger(target.year)) {
    throw new TypeError("Release target year must be an integer");
  }
  if (
    target.releaseDate !== undefined &&
    target.releaseDate !== null &&
    !Number.isFinite(Date.parse(target.releaseDate))
  ) {
    throw new TypeError("Release target date must be a valid ISO date");
  }
  for (const [name, value] of [
    ["season", target.season],
    ["episode", target.episode],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new TypeError(`Release target ${name} must be non-negative`);
    }
  }
}

function validateCandidate(candidate: ReleaseCandidate): void {
  if (!candidate.id || !candidate.title.trim()) {
    throw new TypeError("Release candidate requires an id and title");
  }
  if (!Number.isFinite(candidate.sizeBytes) || candidate.sizeBytes < 0) {
    throw new TypeError("Release candidate size must be non-negative");
  }
  if (!Number.isFinite(candidate.seeders) || candidate.seeders < 0) {
    throw new TypeError("Release candidate seeders must be non-negative");
  }
}
