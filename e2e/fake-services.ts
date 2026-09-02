import { mkdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const port = Number(process.env["FAKE_SERVICES_PORT"] ?? 3101);
let sessionSequence = 1;
let sessionId = `bobarr-e2e-transmission-session-${sessionSequence}`;

type JackettMode = "ready" | "empty" | "degraded";
type SeasonScenario = "standard" | "partially-aired";

interface FakeMedia {
  id: number;
  kind: "movie" | "tv";
  title: string;
}

interface FakeTorrent {
  id: number;
  hash: string;
  name: string;
  status: number;
  downloadDirectory: string;
  labels: string[];
  completed: boolean;
}

const media = new Map<number, FakeMedia>();
const torrents = new Map<string, FakeTorrent>();
let jackettMode: JackettMode = "ready";
let seasonScenario: SeasonScenario = "standard";
let emptyEpisodes = new Set<number>();
let tmdbDegraded = false;
let tmdbAmbiguous = false;
let transmissionDegraded = false;
let torrentSequence = 0;
let torrentAddRequests = 0;

Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ status: "ready" });
    if (url.pathname === "/__control" && request.method === "POST") {
      const input = (await request.json()) as {
        jackettMode?: JackettMode;
        seasonScenario?: SeasonScenario;
        emptyEpisodes?: number[];
        tmdbDegraded?: boolean;
        tmdbAmbiguous?: boolean;
        transmissionDegraded?: boolean;
        restartTransmission?: boolean;
        completeMatching?: string;
        resetTorrents?: boolean;
      };
      if (input.jackettMode !== undefined) jackettMode = input.jackettMode;
      if (input.seasonScenario !== undefined)
        seasonScenario = input.seasonScenario;
      if (input.emptyEpisodes !== undefined)
        emptyEpisodes = new Set(input.emptyEpisodes);
      if (input.tmdbDegraded !== undefined) tmdbDegraded = input.tmdbDegraded;
      if (input.tmdbAmbiguous !== undefined)
        tmdbAmbiguous = input.tmdbAmbiguous;
      if (input.transmissionDegraded !== undefined)
        transmissionDegraded = input.transmissionDegraded;
      if (input.restartTransmission === true) {
        sessionSequence += 1;
        sessionId = `bobarr-e2e-transmission-session-${sessionSequence}`;
      }
      if (input.completeMatching !== undefined) {
        await completeTorrents(input.completeMatching);
      }
      if (input.resetTorrents === true) {
        torrents.clear();
        torrentAddRequests = 0;
      }
      return Response.json({
        jackettMode,
        seasonScenario,
        emptyEpisodes: [...emptyEpisodes],
        tmdbDegraded,
        tmdbAmbiguous,
        transmissionDegraded,
        torrents: torrents.size,
        torrentAddRequests,
      });
    }
    if (url.pathname.startsWith("/tmdb/3/")) {
      return tmdbResponse(url);
    }
    if (url.pathname === "/jackett/api/v2.0/indexers/all/results/torznab/api") {
      return jackettResponse(url);
    }
    if (url.pathname === "/transmission/rpc" && request.method === "POST") {
      return transmissionResponse(request);
    }
    return new Response("Not found", { status: 404 });
  },
});

function tmdbResponse(url: URL): Response {
  if (tmdbDegraded) {
    return Response.json(
      { status_message: "The deterministic TMDB fixture is degraded" },
      { status: 503 },
    );
  }
  const path = url.pathname.slice("/tmdb/3/".length);
  const searchMatch = /^search\/(multi|movie|tv)$/.exec(path);
  if (searchMatch) {
    const title = url.searchParams.get("query")?.trim() || "E2E Movie";
    let kind = mediaKind(title);
    if (searchMatch[1] === "movie") kind = "movie";
    else if (searchMatch[1] === "tv") kind = "tv";
    const item = rememberMedia(title, kind);
    if (!tmdbAmbiguous) return catalogPage([catalogPayload(item)]);
    const alternate = rememberMedia(title, kind, item.id + 1);
    return catalogPage([catalogPayload(item), catalogPayload(alternate)]);
  }
  if (path === "configuration/languages") {
    return Response.json([
      { iso_639_1: "en", english_name: "English", name: "English" },
      { iso_639_1: "fr", english_name: "French", name: "Français" },
    ]);
  }
  if (path === "configuration/countries") {
    return Response.json([
      {
        iso_3166_1: "FR",
        english_name: "France",
        native_name: "France",
      },
      {
        iso_3166_1: "US",
        english_name: "United States of America",
        native_name: "United States",
      },
    ]);
  }
  const genreMatch = /^genre\/(movie|tv)\/list$/.exec(path);
  if (genreMatch) {
    return Response.json({ genres: [{ id: 18, name: "Drama" }] });
  }
  const seasonMatch = /^tv\/(\d+)\/season\/(\d+)$/.exec(path);
  if (seasonMatch) {
    const mediaId = Number(seasonMatch[1]);
    const seasonNumber = Number(seasonMatch[2]);
    return Response.json(seasonPayload(mediaId, seasonNumber));
  }
  const detailMatch = /^(movie|tv)\/(\d+)$/.exec(path);
  if (detailMatch) {
    const kind = detailMatch[1] as "movie" | "tv";
    const id = Number(detailMatch[2]);
    const item =
      media.get(id) ??
      rememberMedia(
        `E2E ${kind === "tv" ? "Series" : "Movie"} ${id}`,
        kind,
        id,
      );
    return Response.json(detailsPayload(item));
  }
  const recommendationMatch = /^(movie|tv)\/(\d+)\/recommendations$/.exec(path);
  if (recommendationMatch) {
    const kind = recommendationMatch[1] as "movie" | "tv";
    const title = `E2E Recommended ${kind === "tv" ? "Series" : "Movie"}`;
    return catalogPage([catalogPayload(rememberMedia(title, kind))]);
  }
  const listingMatch = /^(?:discover\/)?(movie|tv)(?:\/popular)?$/.exec(path);
  if (listingMatch) {
    const kind = listingMatch[1] as "movie" | "tv";
    const title = `E2E Discovery ${kind === "tv" ? "Series" : "Movie"}`;
    return catalogPage([catalogPayload(rememberMedia(title, kind))]);
  }
  return Response.json(
    { status_message: `Unhandled fake TMDB path: ${path}` },
    { status: 404 },
  );
}

function catalogPage(results: unknown[]): Response {
  return Response.json({
    page: 1,
    total_pages: 1,
    total_results: results.length,
    results,
  });
}

function mediaKind(title: string): "movie" | "tv" {
  return /\b(?:series|show|season)\b/i.test(title) ? "tv" : "movie";
}

function rememberMedia(
  title: string,
  kind: "movie" | "tv",
  explicitId?: number,
): FakeMedia {
  const id = explicitId ?? stableMediaId(`${kind}:${title}`);
  const item = { id, kind, title };
  media.set(id, item);
  return item;
}

function stableMediaId(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return 100_000 + (Math.abs(hash) % 800_000_000);
}

function catalogPayload(item: FakeMedia): Record<string, unknown> {
  const dateKey = item.kind === "movie" ? "release_date" : "first_air_date";
  const titleKey = item.kind === "movie" ? "title" : "name";
  const originalTitleKey =
    item.kind === "movie" ? "original_title" : "original_name";
  return {
    id: item.id,
    media_type: item.kind,
    [titleKey]: item.title,
    [originalTitleKey]: item.title,
    overview: `${item.title} is deterministic catalog data for browser tests.`,
    original_language: "en",
    [dateKey]: "2024-02-10",
    poster_path: null,
    backdrop_path: null,
    genre_ids: [18],
    popularity: 42,
    vote_average: 8.2,
    vote_count: 500,
  };
}

function detailsPayload(item: FakeMedia): Record<string, unknown> {
  let numberOfEpisodes: number | undefined;
  if (item.kind === "tv") {
    numberOfEpisodes = seasonScenario === "partially-aired" ? 12 : 4;
  }
  return {
    ...catalogPayload(item),
    genres: [{ id: 18, name: "Drama" }],
    runtime: item.kind === "movie" ? 112 : undefined,
    episode_run_time: item.kind === "tv" ? [48] : undefined,
    status: "Released",
    tagline: "Deterministic by design",
    homepage: null,
    imdb_id: item.kind === "movie" ? "tt1234567" : null,
    number_of_seasons: item.kind === "tv" ? 2 : undefined,
    number_of_episodes: numberOfEpisodes,
    credits:
      item.kind === "movie"
        ? {
            cast: [
              {
                id: 6384,
                name: "E2E Actor",
                character: "The Lead",
                profile_path: null,
                order: 0,
              },
            ],
          }
        : undefined,
    videos: {
      results: [
        {
          name: "Official Trailer",
          key: "e2eTrailerKey",
          site: "YouTube",
          type: "Trailer",
          official: true,
        },
      ],
    },
  };
}

function seasonPayload(mediaId: number, seasonNumber: number) {
  if (seasonScenario === "partially-aired") {
    const airDates = [
      dateOffset(-28),
      dateOffset(-21),
      dateOffset(-14),
      dateOffset(-7),
      dateOffset(7),
      null,
    ];
    return {
      id: mediaId * 10 + seasonNumber,
      name: `Season ${seasonNumber}`,
      overview: `A partially aired season with mixed acquisition states.`,
      air_date: dateOffset(-35),
      season_number: seasonNumber,
      poster_path: null,
      episodes: airDates.map((airDate, index) => ({
        id: mediaId * 100 + seasonNumber * 10 + index + 1,
        name: `Episode ${index + 1}`,
        overview: `Episode ${index + 1} of the partially aired fixture.`,
        air_date: airDate,
        episode_number: index + 1,
        season_number: seasonNumber,
        runtime: 48,
        still_path: null,
        vote_average: 8,
      })),
    };
  }
  return {
    id: mediaId * 10 + seasonNumber,
    name: `Season ${seasonNumber}`,
    overview: `The deterministic season ${seasonNumber}.`,
    air_date: `2024-0${seasonNumber + 2}-01`,
    season_number: seasonNumber,
    poster_path: null,
    episodes: [1, 2].map((episodeNumber) => ({
      id: mediaId * 100 + seasonNumber * 10 + episodeNumber,
      name: `Episode ${episodeNumber}`,
      overview: `Episode ${episodeNumber} of the deterministic fixture.`,
      air_date: `2024-0${seasonNumber + 2}-${String(episodeNumber).padStart(2, "0")}`,
      episode_number: episodeNumber,
      season_number: seasonNumber,
      runtime: 48,
      still_path: null,
      vote_average: 8,
    })),
  };
}

function dateOffset(days: number): string {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function jackettResponse(url: URL): Response {
  if (jackettMode === "degraded") {
    return new Response("Jackett fixture unavailable", { status: 503 });
  }
  if (url.searchParams.get("t") === "indexers") {
    return xml(
      '<?xml version="1.0"?><caps><server title="Bobarr E2E" /></caps>',
    );
  }
  const query = url.searchParams.get("q")?.trim() || "E2E Release";
  if (jackettMode === "empty") return torznabFeed("");
  const season = numericParameter(url, "season");
  const episode = numericParameter(url, "ep");
  if (episode !== null && emptyEpisodes.has(episode)) return torznabFeed("");
  const marker = releaseMarker(season, episode);
  const releaseTitle = query
    .replace(/\s+S\d{1,2}(?:E\d{1,3})?$/i, "")
    .replace(/\s+2024$/, "");
  const title = `${releaseTitle}.2024${marker}.1080p.WEB-DL.x264-BOBARR`;
  const hash = stableInfoHash(
    `${query}:${season ?? "movie"}:${episode ?? "pack"}`,
  );
  const magnet = `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`;
  const item = `
    <item>
      <title>${escapeXml(title)}</title>
      <guid>e2e-${hash}</guid>
      <link><![CDATA[${magnet}]]></link>
      <pubDate>Mon, 20 Jul 2026 10:00:00 GMT</pubDate>
      <torznab:attr name="indexer" value="Bobarr E2E Indexer" />
      <torznab:attr name="size" value="2147483648" />
      <torznab:attr name="seeders" value="42" />
      <torznab:attr name="peers" value="51" />
      <torznab:attr name="infohash" value="${hash}" />
      <torznab:attr name="magneturl" value="${escapeXml(magnet)}" />
      <torznab:attr name="category" value="${season === null ? 2000 : 5000}" />
    </item>`;
  return torznabFeed(item);
}

function releaseMarker(season: number | null, episode: number | null): string {
  if (season === null) return "";
  const seasonMarker = `S${String(season).padStart(2, "0")}`;
  if (episode === null) return `.${seasonMarker}`;
  return `.${seasonMarker}E${String(episode).padStart(2, "0")}`;
}

function torznabFeed(item: string): Response {
  return xml(`<?xml version="1.0" encoding="UTF-8"?>
    <rss xmlns:torznab="http://torznab.com/schemas/2015/feed">
      <channel>
        <title>Bobarr deterministic Jackett</title>
        <torznab:response offset="0" total="${item ? 1 : 0}" />
        ${item}
      </channel>
    </rss>`);
}

function xml(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}

function numericParameter(url: URL, name: string): number | null {
  const value = url.searchParams.get(name);
  return value === null ? null : Number(value);
}

async function transmissionResponse(request: Request): Promise<Response> {
  if (transmissionDegraded) {
    return Response.json({ error: "fixture unavailable" }, { status: 503 });
  }
  if (request.headers.get("x-transmission-session-id") !== sessionId) {
    return new Response(null, {
      status: 409,
      headers: { "x-transmission-session-id": sessionId },
    });
  }
  const input = (await request.json()) as {
    id: number;
    method: string;
    params?: Record<string, unknown>;
  };
  const params = input.params ?? {};
  let result: Record<string, unknown> = {};
  if (input.method === "session_get") {
    result = { version: "4.1.3", rpc_version_semver: "7.0.0" };
  } else if (input.method === "torrent_add") {
    torrentAddRequests += 1;
    const source =
      typeof params["filename"] === "string" ? params["filename"] : null;
    const hash = source
      ? magnetHash(source)
      : metainfoHash(String(params["metainfo"] ?? ""));
    const existing = torrents.get(hash.toLowerCase());
    if (existing) {
      result = {
        torrent_duplicate: {
          id: existing.id,
          name: existing.name,
          hash_string: existing.hash,
        },
      };
    } else {
      const torrent: FakeTorrent = {
        id: ++torrentSequence,
        hash,
        name: source ? magnetName(source) : `E2E metainfo ${torrentSequence}`,
        status: params["paused"] === true ? 0 : 4,
        downloadDirectory: String(
          params["download_dir"] ?? "/tmp/bobarr-e2e/media/downloads",
        ),
        labels: Array.isArray(params["labels"])
          ? params["labels"].filter(
              (value): value is string => typeof value === "string",
            )
          : [],
        completed: false,
      };
      torrents.set(hash.toLowerCase(), torrent);
      result = {
        torrent_added: {
          id: torrent.id,
          name: torrent.name,
          hash_string: torrent.hash,
        },
      };
    }
  } else if (input.method === "torrent_get") {
    const ids = Array.isArray(params["ids"])
      ? new Set(params["ids"].map((value) => String(value).toLowerCase()))
      : null;
    result = {
      torrents: [...torrents.values()]
        .filter(
          (torrent) => ids === null || ids.has(torrent.hash.toLowerCase()),
        )
        .map(transmissionTorrentPayload),
    };
  } else if (
    input.method === "torrent_start" ||
    input.method === "torrent_stop"
  ) {
    updateTorrentStatus(params, input.method === "torrent_start" ? 4 : 0);
  } else if (input.method === "torrent_remove") {
    for (const hash of torrentIds(params)) torrents.delete(hash.toLowerCase());
  }
  return Response.json({ jsonrpc: "2.0", id: input.id, result });
}

function transmissionTorrentPayload(torrent: FakeTorrent) {
  const totalSize = 2_147_483_648;
  const fileNames = torrentFileNames(torrent.name);
  const lengths = fileNames.map((_, index) =>
    index === fileNames.length - 1
      ? totalSize - Math.floor(totalSize / fileNames.length) * index
      : Math.floor(totalSize / fileNames.length),
  );
  const activelyDownloading = !torrent.completed && torrent.status === 4;
  return {
    id: torrent.id,
    hash_string: torrent.hash,
    name: torrent.name,
    status: torrent.completed ? 6 : torrent.status,
    error: 0,
    error_string: "",
    eta: activelyDownloading ? 240 : -1,
    percent_done: torrent.completed ? 1 : 0.42,
    metadata_percent_complete: 1,
    total_size: totalSize,
    size_when_done: totalSize,
    left_until_done: torrent.completed ? 0 : 1_245_707_714,
    rate_download: activelyDownloading ? 4_000_000 : 0,
    rate_upload: 125_000,
    download_dir: torrent.downloadDirectory,
    labels: torrent.labels,
    is_finished: torrent.completed,
    is_stalled: false,
    files: fileNames.map((name, index) => ({ name, length: lengths[index] })),
    file_stats: lengths.map((length) => ({
      bytes_completed: torrent.completed ? length : Math.floor(length * 0.42),
      wanted: true,
      priority: 0,
    })),
  };
}

async function completeTorrents(matching: string): Promise<void> {
  for (const torrent of torrents.values()) {
    if (!torrent.name.includes(matching)) continue;
    const downloadDirectory = resolve(torrent.downloadDirectory);
    const relativeDirectory = relative(
      resolve("/tmp/bobarr-e2e"),
      downloadDirectory,
    );
    const pathSegments = relativeDirectory.split(sep);
    const hasMediaDownloadsSegment = pathSegments.some(
      (segment, index) =>
        segment === "media" && pathSegments[index + 1] === "downloads",
    );
    if (
      relativeDirectory === ".." ||
      relativeDirectory.startsWith(`..${sep}`) ||
      isAbsolute(relativeDirectory) ||
      !hasMediaDownloadsSegment
    ) {
      throw new TypeError("Fake torrent directory escaped the E2E media root");
    }
    await mkdir(downloadDirectory, { recursive: true });
    await Promise.all(
      torrentFileNames(torrent.name).map((fileName) =>
        Bun.write(
          `${downloadDirectory}/${fileName}`,
          `deterministic media for ${fileName}`,
        ),
      ),
    );
    torrent.completed = true;
    torrent.status = 6;
  }
}

function torrentFileNames(torrentName: string): string[] {
  const seasonPack = /\.S(\d{2})(?=\.)/i.exec(torrentName);
  if (!seasonPack) return [`${torrentName}.mkv`];
  return [1, 2].map(
    (episode) =>
      `${torrentName.slice(0, seasonPack.index)}.S${seasonPack[1]}E${String(episode).padStart(2, "0")}${torrentName.slice(seasonPack.index + seasonPack[0].length)}.mkv`,
  );
}

function updateTorrentStatus(
  params: Record<string, unknown>,
  status: number,
): void {
  for (const hash of torrentIds(params)) {
    const torrent = torrents.get(hash.toLowerCase());
    if (torrent) torrent.status = torrent.completed ? 6 : status;
  }
}

function torrentIds(params: Record<string, unknown>): string[] {
  return Array.isArray(params["ids"])
    ? params["ids"].map((value) => String(value))
    : [];
}

function magnetHash(value: string): string {
  try {
    const topic = new URL(value).searchParams
      .getAll("xt")
      .find((candidate) => candidate.toLowerCase().startsWith("urn:btih:"));
    const hash = topic?.slice("urn:btih:".length);
    return hash && /^[a-f\d]{40}$/i.test(hash)
      ? hash.toLowerCase()
      : stableInfoHash(value);
  } catch {
    return stableInfoHash(value);
  }
}

function magnetName(value: string): string {
  try {
    return new URL(value).searchParams.get("dn")?.trim() || "E2E magnet";
  } catch {
    return "E2E magnet";
  }
}

function metainfoHash(value: string): string {
  return stableInfoHash(`${value}:${torrentSequence + 1}`);
}

function stableInfoHash(value: string): string {
  return new Bun.CryptoHasher("sha1").update(value).digest("hex");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
