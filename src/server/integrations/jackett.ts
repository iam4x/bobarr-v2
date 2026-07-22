import {
  IntegrationError,
  type FetchLike,
  asFiniteNumber,
  asString,
  requestSignal,
} from "./http";

const DEFAULT_BASE_URL = "http://jackett:9117/";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_TORRENT_BYTES = 10 * 1024 * 1024;

export type TorznabSearchType = "search" | "movie" | "tvsearch";

export interface JackettSearchRequest {
  query: string;
  type?: TorznabSearchType;
  categories?: readonly number[];
  tmdbId?: number;
  imdbId?: string;
  tvdbId?: number;
  season?: number;
  episode?: number;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export interface JackettRelease {
  id: string;
  title: string;
  indexer: string | null;
  description: string | null;
  publishedAt: string | null;
  sizeBytes: number;
  seeders: number;
  peers: number;
  grabs: number;
  categories: readonly number[];
  downloadUrl: string | null;
  magnetUri: string | null;
  infoHash: string | null;
}

export interface JackettSearchPage {
  offset: number;
  total: number;
  results: readonly JackettRelease[];
}

export interface JackettClient {
  health(signal?: AbortSignal): Promise<void>;
  search(request: JackettSearchRequest): Promise<JackettSearchPage>;
  downloadTorrent(url: string, signal?: AbortSignal): Promise<Uint8Array>;
}

export interface JackettClientOptions {
  apiKey: string;
  baseUrl?: string;
  indexerId?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  maxTorrentBytes?: number;
  maxRedirects?: number;
}

export function createJackettClient(
  options: JackettClientOptions,
): JackettClient {
  if (!options.apiKey.trim()) {
    throw new TypeError("Jackett API key is required");
  }
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const indexerId = validateIndexerId(options.indexerId ?? "all");
  const endpoint = new URL(
    `api/v2.0/indexers/${encodeURIComponent(indexerId)}/results/torznab/api`,
    baseUrl,
  );
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxTorrentBytes = options.maxTorrentBytes ?? DEFAULT_MAX_TORRENT_BYTES;
  const maxRedirects = options.maxRedirects ?? 3;

  if (!Number.isSafeInteger(maxTorrentBytes) || maxTorrentBytes <= 0) {
    throw new TypeError("maxTorrentBytes must be a positive integer");
  }
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new TypeError("maxRedirects must be a non-negative integer");
  }

  async function search(
    searchRequest: JackettSearchRequest,
  ): Promise<JackettSearchPage> {
    const query = searchRequest.query.trim();
    if (!query && !searchRequest.tmdbId && !searchRequest.imdbId) {
      throw new TypeError("A Jackett query or external media id is required");
    }
    const url = new URL(endpoint);
    url.searchParams.set("apikey", options.apiKey);
    url.searchParams.set("t", searchRequest.type ?? "search");
    if (query) url.searchParams.set("q", query);
    if (searchRequest.categories?.length) {
      const categories = searchRequest.categories.map(validCategory);
      url.searchParams.set("cat", [...new Set(categories)].join(","));
    }
    addPositiveInteger(url, "tmdbid", searchRequest.tmdbId);
    addPositiveInteger(url, "tvdbid", searchRequest.tvdbId);
    addNonNegativeInteger(url, "season", searchRequest.season);
    addNonNegativeInteger(url, "ep", searchRequest.episode);
    if (searchRequest.imdbId) {
      if (!/^tt\d{7,10}$/i.test(searchRequest.imdbId)) {
        throw new TypeError("Invalid IMDb id");
      }
      url.searchParams.set("imdbid", searchRequest.imdbId);
    }
    if (searchRequest.limit !== undefined) {
      if (
        !Number.isSafeInteger(searchRequest.limit) ||
        searchRequest.limit <= 0 ||
        searchRequest.limit > 1000
      ) {
        throw new TypeError("Jackett limit must be an integer from 1 to 1000");
      }
      url.searchParams.set("limit", String(searchRequest.limit));
    }
    addNonNegativeInteger(url, "offset", searchRequest.offset);

    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { accept: "application/rss+xml, application/xml, text/xml" },
        signal: requestSignal(timeoutMs, searchRequest.signal),
      });
    } catch (error) {
      throw new IntegrationError("jackett", "Jackett search failed", {
        cause: error,
        retryable: true,
      });
    }
    if (!response.ok) {
      throw new IntegrationError(
        "jackett",
        `Jackett returned HTTP ${response.status}`,
        { status: response.status, retryable: response.status >= 500 },
      );
    }
    const xml = await response.text();
    return parseTorznabFeed(xml);
  }

  async function downloadTorrent(
    input: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    let url = validateDownloadUrl(input, baseUrl);
    for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
      let response: Response;
      try {
        response = await fetcher(url, {
          headers: { accept: "application/x-bittorrent" },
          redirect: "manual",
          signal: requestSignal(timeoutMs, signal),
        });
      } catch (error) {
        throw new IntegrationError(
          "jackett",
          "Failed to fetch torrent metadata from Jackett",
          { cause: error, retryable: true },
        );
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirect === maxRedirects) {
          throw new IntegrationError(
            "jackett",
            "Jackett torrent redirect could not be followed safely",
            { status: response.status },
          );
        }
        url = validateDownloadUrl(new URL(location, url).href, baseUrl);
        continue;
      }
      if (!response.ok) {
        throw new IntegrationError(
          "jackett",
          `Jackett torrent download returned HTTP ${response.status}`,
          { status: response.status, retryable: response.status >= 500 },
        );
      }
      const contentLength = asFiniteNumber(
        response.headers.get("content-length"),
      );
      if (contentLength !== undefined && contentLength > maxTorrentBytes) {
        throw new IntegrationError(
          "jackett",
          "Jackett torrent metadata exceeded the configured size limit",
          { status: 413 },
        );
      }
      const metadata = await readLimitedBody(response, maxTorrentBytes);
      if (metadata[0] !== 0x64) {
        throw new IntegrationError(
          "jackett",
          "Jackett did not return valid bencoded torrent metadata",
        );
      }
      return metadata;
    }
    throw new IntegrationError("jackett", "Too many torrent redirects");
  }

  async function health(signal?: AbortSignal): Promise<void> {
    const url = new URL(endpoint);
    url.searchParams.set("apikey", options.apiKey);
    url.searchParams.set("t", "indexers");
    url.searchParams.set("configured", "true");
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { accept: "application/xml, text/xml" },
        signal: requestSignal(timeoutMs, signal),
      });
    } catch (error) {
      throw new IntegrationError("jackett", "Jackett health check failed", {
        cause: error,
        retryable: true,
      });
    }
    if (!response.ok) {
      throw new IntegrationError(
        "jackett",
        `Jackett returned HTTP ${response.status}`,
        { status: response.status, retryable: response.status >= 500 },
      );
    }
    const payload = await response.text();
    throwTorznabError(payload);
    if (!isTorznabCapabilityDocument(payload)) {
      throw new IntegrationError(
        "jackett",
        "Jackett returned an invalid Torznab capability response",
      );
    }
  }

  return { health, search, downloadTorrent };
}

export function parseTorznabFeed(xml: string): JackettSearchPage {
  if (xml.length > 20 * 1024 * 1024) {
    throw new IntegrationError("jackett", "Torznab response was too large");
  }
  throwTorznabError(xml);
  const responseAttributes = firstElementAttributes(xml, "response");
  const offset = nonNegativeInteger(responseAttributes["offset"], 0);
  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi;
  const results: JackettRelease[] = [];
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(xml)) !== null) {
    if (match[1]) results.push(parseTorznabItem(match[1], results.length));
  }
  return {
    offset,
    total: nonNegativeInteger(responseAttributes["total"], results.length),
    results,
  };
}

function parseTorznabItem(xml: string, index: number): JackettRelease {
  const attributes = torznabAttributes(xml);
  const enclosure = firstElementAttributes(xml, "enclosure");
  const title = elementText(xml, "title");
  if (!title) {
    throw new IntegrationError("jackett", "Torznab item omitted its title");
  }
  const guid = elementText(xml, "guid");
  const link = elementText(xml, "link") ?? enclosure["url"];
  const magnet = firstMagnet(
    attributes["magneturl"],
    link,
    guid,
    elementText(xml, "comments"),
  );
  const downloadUrl = firstHttpUrl(link, enclosure["url"]);
  const categories = attributes["category"] ?? [];
  const size = firstDefinedNumber(
    firstAttribute(attributes, "size"),
    enclosure["length"],
  );
  const id =
    guid ??
    firstAttribute(attributes, "infohash") ??
    magnet ??
    downloadUrl ??
    `jackett-result-${index}`;
  return {
    id,
    title,
    indexer:
      firstAttribute(attributes, "indexer") ??
      elementText(xml, "jackettindexer"),
    description: elementText(xml, "description"),
    publishedAt: validDateString(elementText(xml, "pubDate")),
    sizeBytes: Math.max(0, size ?? 0),
    seeders: nonNegativeInteger(firstAttribute(attributes, "seeders"), 0),
    peers: nonNegativeInteger(
      firstAttribute(attributes, "peers") ??
        firstAttribute(attributes, "leechers"),
      0,
    ),
    grabs: nonNegativeInteger(firstAttribute(attributes, "grabs"), 0),
    categories: categories.flatMap((value) => {
      const number = Number(value);
      return Number.isSafeInteger(number) && number >= 0 ? [number] : [];
    }),
    downloadUrl,
    magnetUri: magnet,
    infoHash: normalizeInfoHash(firstAttribute(attributes, "infohash")),
  };
}

function torznabAttributes(xml: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const pattern = /<(?:torznab:)?attr\b([^>]*)\/?\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const attributes = parseAttributes(match[1] ?? "");
    const name = attributes["name"]?.toLowerCase();
    const value = attributes["value"];
    if (name && value !== undefined) {
      (result[name] ??= []).push(value);
    }
  }
  return result;
}

function firstElementAttributes(
  xml: string,
  element: string,
): Record<string, string> {
  const match = new RegExp(`<(?:(?:\\w+):)?${element}\\b([^>]*)>`, "i").exec(
    xml,
  );
  return parseAttributes(match?.[1] ?? "");
}

function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const name = match[1]?.toLowerCase();
    const raw = match[2] ?? match[3];
    if (name && raw !== undefined) attributes[name] = decodeXml(raw);
  }
  return attributes;
}

function elementText(xml: string, element: string): string | null {
  const match = new RegExp(
    `<(?:(?:\\w+):)?${element}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:\\w+):)?${element}\\s*>`,
    "i",
  ).exec(xml);
  if (!match?.[1]) return null;
  const value = match[1]
    .replace(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/i, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
  return value ? decodeXml(value) : null;
}

function decodeXml(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([a-f\d]+)|amp|lt|gt|quot|apos);/gi,
    (entity, decimal: string | undefined, hex: string | undefined) => {
      if (decimal) return safeCodePoint(Number(decimal), entity);
      if (hex) return safeCodePoint(Number.parseInt(hex, 16), entity);
      const named: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      };
      return named[entity.toLowerCase()] ?? entity;
    },
  );
}

function safeCodePoint(value: number, fallback: string): string {
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

function firstAttribute(
  attributes: Record<string, string[]>,
  name: string,
): string | undefined {
  return attributes[name]?.[0];
}

function firstDefinedNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = asFiniteNumber(value);
    if (number !== undefined) return number;
  }
  return undefined;
}

function firstMagnet(...values: unknown[]): string | null {
  for (const value of values) {
    const string = asString(value);
    if (!string?.toLowerCase().startsWith("magnet:?")) continue;
    try {
      const url = new URL(string);
      if (url.searchParams.getAll("xt").some(isSupportedExactTopic)) {
        return string;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function isSupportedExactTopic(value: string): boolean {
  return /^(?:urn:btih:(?:[a-f\d]{40}|[a-z2-7]{32})|urn:btmh:1220[a-f\d]{64})$/i.test(
    value,
  );
}

function firstHttpUrl(...values: unknown[]): string | null {
  for (const value of values) {
    const string = asString(value);
    if (!string) continue;
    try {
      const url = new URL(string);
      if (url.protocol === "http:" || url.protocol === "https:") return string;
    } catch {
      continue;
    }
  }
  return null;
}

function normalizeInfoHash(value: string | undefined): string | null {
  if (!value) return null;
  return /^(?:[a-f\d]{40}|[a-z2-7]{32}|1220[a-f\d]{64})$/i.test(value)
    ? value
    : null;
}

function validDateString(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Jackett base URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new TypeError("Jackett base URL must not contain credentials");
  }

  // Accept the instance URL as well as URLs commonly copied from Jackett's
  // dashboard or "Copy Torznab Feed" action. Only the path before Jackett's
  // well-known UI/API suffix is retained, which preserves reverse-proxy
  // prefixes such as /jackett without trusting query parameters from the
  // pasted URL.
  const knownSuffixes = [/\/api\/v2\.0\/indexers(?:\/|$)/i, /\/ui(?:\/|$)/i];
  const suffixIndexes = knownSuffixes
    .map((pattern) => pattern.exec(url.pathname)?.index)
    .filter((index): index is number => index !== undefined);
  if (suffixIndexes.length > 0) {
    const prefix = url.pathname.slice(0, Math.min(...suffixIndexes));
    url.pathname = prefix ? `${prefix.replace(/\/+$/, "")}/` : "/";
  } else if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  url.search = "";
  url.hash = "";
  return url;
}

function isTorznabCapabilityDocument(value: string): boolean {
  const root = completeXmlRoot(value);
  return root !== null && ["caps", "indexers", "rss"].includes(root.localName);
}

function throwTorznabError(value: string): void {
  const root = completeXmlRoot(value);
  if (root?.localName !== "error") return;

  const code = /^\d{3}$/.test(root.attributes["code"] ?? "")
    ? root.attributes["code"]!
    : null;
  const mapped = torznabError(code);
  throw new IntegrationError("jackett", mapped.message, {
    status: mapped.status,
    retryable: mapped.retryable,
    ...(code === null ? {} : { details: { torznabCode: code } }),
  });
}

function torznabError(code: string | null): {
  message: string;
  status: number;
  retryable: boolean;
} {
  switch (code) {
    case "100":
      return {
        message: "Jackett rejected the API key",
        status: 401,
        retryable: false,
      };
    case "101":
      return {
        message: "Jackett reports that the account is suspended",
        status: 403,
        retryable: false,
      };
    case "102":
      return {
        message: "Jackett reports insufficient API privileges",
        status: 403,
        retryable: false,
      };
    case "200":
      return {
        message: "Jackett requires an additional request parameter",
        status: 400,
        retryable: false,
      };
    case "201":
      return {
        message: "Jackett rejected a request parameter",
        status: 400,
        retryable: false,
      };
    case "202":
      return {
        message: "Jackett does not support the requested search function",
        status: 422,
        retryable: false,
      };
    case "203":
      return {
        message: "The requested Jackett search function is unavailable",
        status: 422,
        retryable: false,
      };
    case "300":
      return {
        message: "Jackett could not find the requested item",
        status: 404,
        retryable: false,
      };
    case "500":
      return {
        message: "Jackett request limit was reached",
        status: 429,
        retryable: true,
      };
    case "501":
      return {
        message: "Jackett download limit was reached",
        status: 429,
        retryable: true,
      };
    case "502":
    case "503":
      return {
        message: "A Jackett indexer service is unavailable",
        status: 503,
        retryable: true,
      };
    case "900":
      return {
        message: "Jackett returned an unknown Torznab error",
        status: 502,
        retryable: true,
      };
    case "910":
      return {
        message: "Jackett API access is disabled",
        status: 503,
        retryable: false,
      };
    default:
      return {
        message: "Jackett rejected the Torznab request",
        status: 502,
        retryable: false,
      };
  }
}

function completeXmlRoot(
  value: string,
): { localName: string; attributes: Record<string, string> } | null {
  const document = stripXmlPreamble(value);
  const opening =
    /^<(?:(?:[A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*)\b([^>]*)>/i.exec(document);
  const localName = opening?.[1]?.toLowerCase();
  if (!opening || !localName) return null;

  const remainder = document.slice(opening[0].length);
  if (/\/\s*>$/.test(opening[0])) {
    return isXmlTrivia(remainder)
      ? { localName, attributes: parseAttributes(opening[2] ?? "") }
      : null;
  }

  const closing = new RegExp(
    `<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${localName}\\s*>`,
    "gi",
  );
  let closingMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = closing.exec(remainder)) !== null) {
    closingMatch = match;
  }
  if (
    closingMatch === null ||
    !isXmlTrivia(remainder.slice(closingMatch.index + closingMatch[0].length))
  ) {
    return null;
  }
  return { localName, attributes: parseAttributes(opening[2] ?? "") };
}

function stripXmlPreamble(value: string): string {
  let document = value.replace(/^\uFEFF/, "").trimStart();
  while (document.startsWith("<?") || document.startsWith("<!--")) {
    const terminator = document.startsWith("<?") ? "?>" : "-->";
    const end = document.indexOf(terminator);
    if (end < 0) return "";
    document = document.slice(end + terminator.length).trimStart();
  }
  return document;
}

function isXmlTrivia(value: string): boolean {
  return value.replace(/<!--[\s\S]*?-->/g, "").trim() === "";
}

function validateIndexerId(value: string): string {
  if (!/^[a-z\d_-]+$/i.test(value)) {
    throw new TypeError("Invalid Jackett indexer id");
  }
  return value;
}

function validateDownloadUrl(input: string, base: URL): URL {
  const url = new URL(input, base);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Jackett torrent URL must use HTTP or HTTPS");
  }
  if (url.origin !== base.origin) {
    throw new TypeError("Torrent metadata may only be fetched from Jackett");
  }
  return url;
}

function addPositiveInteger(
  url: URL,
  name: string,
  value: number | undefined,
): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  url.searchParams.set(name, String(value));
}

function addNonNegativeInteger(
  url: URL,
  name: string,
  value: number | undefined,
): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  url.searchParams.set(name, String(value));
}

function validCategory(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Torznab categories must be non-negative integers");
  }
  return value;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const number = asFiniteNumber(value);
  return number !== undefined && Number.isSafeInteger(number) && number >= 0
    ? number
    : fallback;
}

async function readLimitedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new IntegrationError(
          "jackett",
          "Jackett torrent metadata exceeded the configured size limit",
          { status: 413 },
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
