import type { ReleaseTarget } from "../domain/releases";
import type {
  AddTorrentOptions,
  AddedTorrent,
  CandidateRepository,
  DownloadPatch,
  DownloadRecord,
  DownloadRepository,
  DownloadState,
  IndexerGateway,
  IndexerRelease,
  IndexerSearchRequest,
  LibraryOrganizer,
  NewStoredCandidate,
  StoredCandidate,
  TorrentEngine,
  TorrentInput,
  TorrentSnapshot,
} from "./ports";

import { describe, expect, test } from "bun:test";

import {
  ADD_TORRENT_JOB,
  CANDIDATE_TTL_MS,
  ORGANIZE_DOWNLOAD_JOB,
  createAcquisitionJobHandlers,
  createAcquisitionService,
  InvalidAcquisitionSourceError,
} from "./acquisition-service";
import { createAesCandidateCipher } from "./candidate-cipher";
import { createJobWorker, createSqliteJobQueue } from "../jobs";

const CANDIDATE_ID = `rel_${"a".repeat(43)}`;
const DOWNLOAD_ID = "22222222-2222-4222-8222-222222222222";
const ORPHAN_ID = "33333333-3333-4333-8333-333333333333";
const SECOND_DOWNLOAD_ID = "44444444-4444-4444-8444-444444444444";
const HASH = "0123456789abcdef0123456789abcdef01234567";
const OTHER_HASH = "abcdef0123456789abcdef0123456789abcdef01";
const TARGET: ReleaseTarget = { kind: "movie", title: "Dune", year: 2021 };

describe("candidate protection", () => {
  test("authenticates encrypted candidate sources", async () => {
    const cipher = createAesCandidateCipher({
      key: new Uint8Array(32).fill(7),
    });
    const source = { kind: "magnet", magnetUri: magnet(HASH) } as const;
    const payload = { source, target: TARGET, infoHash: HASH } as const;
    const token = await cipher.seal(payload);
    expect(token).not.toContain("magnet");
    await expect(cipher.open(token)).resolves.toEqual(payload);

    const parts = token.split(".");
    const ciphertext = parts[2];
    if (!parts[0] || !parts[1] || !ciphertext) throw new Error("bad fixture");
    const replacement = ciphertext[0] === "A" ? "B" : "A";
    const tampered = `${parts[0]}.${parts[1]}.${replacement}${ciphertext.slice(1)}`;
    await expect(cipher.open(tampered)).rejects.toThrow("authenticated");
  });
});

describe("acquisition service", () => {
  test("deduplicates, scores, encrypts, and expires Jackett candidates", async () => {
    const now = 100_000;
    const candidateRepository = new MemoryCandidateRepository();
    const releases = [
      release({ id: "weak", seeders: 5, infoHash: HASH }),
      release({ id: "strong", seeders: 50, infoHash: HASH }),
      release({
        id: "wrong-year",
        title: "Dune.1984.1080p.WEB-DL.x265-GRP",
        infoHash: OTHER_HASH,
        magnetUri: magnet(OTHER_HASH),
      }),
    ];
    const fixture = serviceFixture({
      releases,
      candidateRepository,
      now: () => now,
    });

    const result = await fixture.service.searchCandidates({
      target: TARGET,
      profile: { qualityOrder: ["1080p", "720p"] },
    });

    expect(result.rawTotal).toBe(3);
    expect(result.deduplicatedTotal).toBe(2);
    expect(result.query).toBe("Dune 2021");
    expect(fixture.indexer.requests[0]?.query).toBe("Dune 2021");
    expect(result.expiresAt).toBe(now + CANDIDATE_TTL_MS);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      id: CANDIDATE_ID,
      seeders: 50,
      expiresAt: now + CANDIDATE_TTL_MS,
    });
    expect(result.excluded[0]?.exclusions).toContain(
      "release year 1984 does not match 2021",
    );
    expect(JSON.stringify(result)).not.toContain("magnet:?");
    const stored = await candidateRepository.findById(CANDIDATE_ID);
    expect(stored?.sourceCiphertext).not.toContain("magnet:?");
    await expect(
      fixture.cipher.open(requireValue(stored).sourceCiphertext),
    ).resolves.toEqual({
      source: { kind: "magnet", magnetUri: magnet(HASH) },
      target: TARGET,
      infoHash: HASH,
    });
    fixture.queue.close();
  });

  test("does not expose an automatic candidate before the target release date", async () => {
    const fixture = serviceFixture({
      releases: [release({ id: "future", infoHash: HASH })],
      now: () => Date.parse("2030-05-01T00:00:00.000Z"),
    });

    const result = await fixture.service.searchCandidates({
      target: {
        ...TARGET,
        releaseDate: "2030-06-01T00:00:00.000Z",
      },
    });

    expect(result.candidates).toEqual([]);
    expect(result.excluded[0]?.exclusions).toContain(
      "media is not released until 2030-06-01T00:00:00.000Z",
    );
    expect(await fixture.queue.count()).toBe(0);
    fixture.queue.close();
  });

  test("uses and returns a trimmed manual Jackett query without changing the target", async () => {
    const fixture = serviceFixture({
      releases: [release({ id: "proper", infoHash: HASH })],
    });

    const result = await fixture.service.searchCandidates({
      target: TARGET,
      query: "  Dune 2021 PROPER  ",
    });

    expect(result.query).toBe("Dune 2021 PROPER");
    expect(fixture.indexer.requests[0]).toMatchObject({
      query: "Dune 2021 PROPER",
      tmdbId: undefined,
      type: "movie",
    });
    expect(result.candidates).toHaveLength(1);
    fixture.queue.close();
  });

  test("persists before Jackett and Transmission side effects", async () => {
    const events: string[] = [];
    const candidateRepository = new MemoryCandidateRepository();
    const downloadRepository = new MemoryDownloadRepository(events);
    const fixture = serviceFixture({
      releases: [
        release({
          id: "jackett",
          infoHash: null,
          magnetUri: null,
          downloadUrl: "http://jackett:9117/dl/release",
        }),
      ],
      candidateRepository,
      downloadRepository,
      events,
      ids: [DOWNLOAD_ID],
      prepareDownloadDirectory: async (path) => {
        events.push(`filesystem:prepare:${path}`);
      },
    });
    const search = await fixture.service.searchCandidates({ target: TARGET });
    const candidate = requireValue(search.candidates[0]);
    const view = await fixture.service.startFromCandidate(candidate.id);

    expect(view).toMatchObject({
      id: DOWNLOAD_ID,
      state: "queued",
      engineLabel: `bobarr:${DOWNLOAD_ID}`,
      downloadDirectory: `/downloads/${DOWNLOAD_ID}`,
    });
    expect("sourceCiphertext" in view).toBe(false);
    expect(
      (await fixture.queue.list({ types: [ADD_TORRENT_JOB] }))[0],
    ).toMatchObject({ payload: { downloadId: DOWNLOAD_ID } });

    await fixture.service.runAddJob(DOWNLOAD_ID);
    expect(await downloadRepository.findById(DOWNLOAD_ID)).toMatchObject({
      state: "downloading",
      engineInfoHash: HASH,
      error: null,
    });
    expect(fixture.engine.added[0]?.options).toMatchObject({
      labels: [`bobarr:${DOWNLOAD_ID}`],
      downloadDirectory: `/downloads/${DOWNLOAD_ID}`,
    });
    expect(fixture.engine.added[0]?.source).toMatchObject({
      metainfo: new Uint8Array([0x64, 0x65]),
    });
    expect(events.indexOf("db:submitting")).toBeLessThan(
      events.indexOf("external:jackett"),
    );
    expect(events.indexOf("external:jackett")).toBeLessThan(
      events.indexOf(`filesystem:prepare:/downloads/${DOWNLOAD_ID}`),
    );
    expect(
      events.indexOf(`filesystem:prepare:/downloads/${DOWNLOAD_ID}`),
    ).toBeLessThan(events.indexOf("external:transmission"));
    fixture.queue.close();
  });

  test("validates manual magnet and metainfo before persistence", async () => {
    const downloadRepository = new MemoryDownloadRepository();
    const fixture = serviceFixture({
      downloadRepository,
      ids: [DOWNLOAD_ID, SECOND_DOWNLOAD_ID],
      maxMetainfoBytes: 2,
    });
    await expect(
      fixture.service.startFromMagnet({
        target: TARGET,
        magnetUri: "https://example.invalid/file",
      }),
    ).rejects.toBeInstanceOf(InvalidAcquisitionSourceError);
    await expect(
      fixture.service.startFromMagnet({
        target: TARGET,
        magnetUri: "magnet://[tracker-passkey-must-not-escape",
      }),
    ).rejects.toThrow("Magnet URI is invalid");
    await expect(
      fixture.service.startFromMetainfo({
        target: TARGET,
        metainfo: new Uint8Array([0x64, 1, 2]),
      }),
    ).rejects.toThrow("exceeds");
    expect(downloadRepository.records.size).toBe(0);

    await expect(
      fixture.service.startFromMagnet({
        target: TARGET,
        magnetUri: magnet(HASH),
      }),
    ).resolves.toMatchObject({
      id: DOWNLOAD_ID,
      expectedInfoHash: HASH,
      state: "queued",
    });
    fixture.queue.close();
  });

  test("rejects an unmanaged duplicate torrent", async () => {
    const fixture = serviceFixture({ ids: [DOWNLOAD_ID] });
    await fixture.service.startFromMagnet({
      target: TARGET,
      magnetUri: magnet(HASH),
    });
    fixture.engine.torrents.set(HASH, torrent(HASH, [], false));
    fixture.engine.returnDuplicate = true;

    await expect(fixture.service.runAddJob(DOWNLOAD_ID)).rejects.toThrow(
      "not owned by this download",
    );
    expect(
      await fixture.downloadRepository.findById(DOWNLOAD_ID),
    ).toMatchObject({
      state: "failed",
      engineInfoHash: null,
      error:
        "Torrent already exists in Transmission and is not owned by this download",
    });
    fixture.queue.close();
  });

  test("adopts a duplicate created before a database transition", async () => {
    const fixture = serviceFixture({ ids: [DOWNLOAD_ID] });
    await fixture.service.startFromMagnet({
      target: TARGET,
      magnetUri: magnet(HASH),
    });
    fixture.engine.torrents.set(
      HASH,
      torrent(HASH, [`bobarr:${DOWNLOAD_ID}`], false),
    );
    fixture.engine.returnDuplicate = true;

    await fixture.service.runAddJob(DOWNLOAD_ID);

    expect(
      await fixture.downloadRepository.findById(DOWNLOAD_ID),
    ).toMatchObject({
      state: "downloading",
      engineInfoHash: HASH,
      error: null,
    });
    fixture.queue.close();
  });

  test("reconciles by Bobarr label and runs durable organization", async () => {
    const downloadRepository = new MemoryDownloadRepository();
    const organizer = new RecordingOrganizer();
    const fixture = serviceFixture({
      downloadRepository,
      organizer,
      ids: [DOWNLOAD_ID],
    });
    await fixture.service.startFromMagnet({
      target: TARGET,
      magnetUri: magnet(HASH),
    });
    const worker = createJobWorker({
      queue: fixture.queue,
      handlers: createAcquisitionJobHandlers(fixture.service),
      workerId: "test-worker",
    });
    expect(await worker.runOnce()).toBe(true);
    fixture.engine.complete(HASH);
    fixture.engine.torrents.set(
      OTHER_HASH,
      torrent(OTHER_HASH, [`bobarr:${ORPHAN_ID}`], true),
    );

    const reconciliation = await fixture.service.reconcile();
    expect(reconciliation).toMatchObject({
      matched: 1,
      missing: [],
      orphanedTorrents: [{ hash: OTHER_HASH, label: `bobarr:${ORPHAN_ID}` }],
    });
    expect(await downloadRepository.findById(DOWNLOAD_ID)).toMatchObject({
      state: "completed",
      progress: 1,
    });
    expect(
      await fixture.queue.count({
        types: [ORGANIZE_DOWNLOAD_JOB],
        states: ["queued"],
      }),
    ).toBe(1);

    expect(await worker.runOnce()).toBe(true);
    expect(await downloadRepository.findById(DOWNLOAD_ID)).toMatchObject({
      state: "organized",
    });
    expect(organizer.requests).toHaveLength(1);
    fixture.queue.close();
  });

  test("requires matching label, UUID directory, and infohash to reconcile", async () => {
    const unsafeTorrents = [
      {
        name: "missing Bobarr label",
        torrent: torrent(HASH, [], false),
      },
      {
        name: "wrong UUID directory",
        torrent: torrent(HASH, [`bobarr:${DOWNLOAD_ID}`], false, {
          downloadDirectory: `/downloads/${ORPHAN_ID}`,
        }),
      },
      {
        name: "wrong infohash",
        torrent: torrent(OTHER_HASH, [`bobarr:${DOWNLOAD_ID}`], false),
      },
    ];

    for (const unsafe of unsafeTorrents) {
      const fixture = serviceFixture({ ids: [DOWNLOAD_ID] });
      try {
        await fixture.service.startFromMagnet({
          target: TARGET,
          magnetUri: magnet(HASH),
        });
        await fixture.service.runAddJob(DOWNLOAD_ID);
        fixture.engine.torrents.clear();
        fixture.engine.torrents.set(unsafe.torrent.hash, unsafe.torrent);

        const reconciliation = await fixture.service.reconcile();

        expect(reconciliation.matched, unsafe.name).toBe(0);
        expect(reconciliation.missing, unsafe.name).toEqual([DOWNLOAD_ID]);
        expect(
          await fixture.downloadRepository.findById(DOWNLOAD_ID),
          unsafe.name,
        ).toMatchObject({
          state: "missing",
          error: "Torrent is missing from Transmission",
        });
      } finally {
        fixture.queue.close();
      }
    }
  });

  test("retries filesystem organization after a transient failure", async () => {
    const downloadRepository = new MemoryDownloadRepository();
    const organizer = new FlakyOrganizer(1);
    const fixture = serviceFixture({
      downloadRepository,
      organizer,
      ids: [DOWNLOAD_ID],
    });
    await fixture.service.startFromMagnet({
      target: TARGET,
      magnetUri: magnet(HASH),
    });
    await fixture.service.runAddJob(DOWNLOAD_ID);
    fixture.engine.complete(HASH);
    await fixture.service.reconcile();

    await expect(fixture.service.runOrganizeJob(DOWNLOAD_ID)).rejects.toThrow(
      "temporary disk error",
    );
    expect(await downloadRepository.findById(DOWNLOAD_ID)).toMatchObject({
      state: "failed",
      error: "Organization failed: temporary disk error",
    });

    await fixture.service.runOrganizeJob(DOWNLOAD_ID);
    expect(await downloadRepository.findById(DOWNLOAD_ID)).toMatchObject({
      state: "organized",
      progress: 1,
      error: null,
    });
    expect(organizer.attempts).toBe(2);
    fixture.queue.close();
  });

  test("refuses to organize a same-hash torrent without Bobarr ownership", async () => {
    const organizer = new RecordingOrganizer();
    const fixture = serviceFixture({ organizer, ids: [DOWNLOAD_ID] });
    await fixture.service.startFromMagnet({
      target: TARGET,
      magnetUri: magnet(HASH),
    });
    await fixture.service.runAddJob(DOWNLOAD_ID);
    fixture.engine.complete(HASH);
    await fixture.service.reconcile();
    const completed = requireValue(fixture.engine.torrents.get(HASH));
    fixture.engine.torrents.set(HASH, { ...completed, labels: [] });

    await expect(fixture.service.runOrganizeJob(DOWNLOAD_ID)).rejects.toThrow(
      "ownership could not be verified",
    );
    expect(organizer.requests).toHaveLength(0);
    expect(
      await fixture.downloadRepository.findById(DOWNLOAD_ID),
    ).toMatchObject({
      state: "failed",
      error:
        "Organization failed: Transmission torrent ownership could not be verified",
    });
    fixture.queue.close();
  });
});

function serviceFixture(
  options: {
    releases?: readonly IndexerRelease[];
    candidateRepository?: MemoryCandidateRepository;
    downloadRepository?: MemoryDownloadRepository;
    organizer?: LibraryOrganizer;
    events?: string[];
    now?: () => number;
    ids?: readonly string[];
    maxMetainfoBytes?: number;
    prepareDownloadDirectory?: (path: string) => Promise<void>;
  } = {},
) {
  const events = options.events ?? [];
  const indexer = new FakeIndexer(options.releases ?? [], events);
  const engine = new FakeTorrentEngine(events);
  const candidateRepository =
    options.candidateRepository ?? new MemoryCandidateRepository();
  const downloadRepository =
    options.downloadRepository ?? new MemoryDownloadRepository(events);
  const cipher = createAesCandidateCipher({ key: new Uint8Array(32).fill(9) });
  const queue = createSqliteJobQueue({ database: ":memory:" });
  const ids = [...(options.ids ?? [])];
  const service = createAcquisitionService(
    {
      indexer,
      torrentEngine: engine,
      candidateRepository,
      downloadRepository,
      candidateCipher: cipher,
      jobQueue: queue,
      libraryOrganizer: options.organizer,
    },
    {
      now: options.now,
      maxMetainfoBytes: options.maxMetainfoBytes,
      prepareDownloadDirectory: options.prepareDownloadDirectory,
      id: () => ids.shift() ?? crypto.randomUUID(),
    },
  );
  return {
    service,
    indexer,
    engine,
    candidateRepository,
    downloadRepository,
    cipher,
    queue,
  };
}

class MemoryCandidateRepository implements CandidateRepository {
  readonly records = new Map<string, StoredCandidate>();
  private sequence = 0;

  async saveMany(
    candidates: readonly NewStoredCandidate[],
  ): Promise<readonly StoredCandidate[]> {
    return candidates.map((candidate) => {
      const id =
        this.sequence++ === 0
          ? CANDIDATE_ID
          : `rel_${String(this.sequence).padStart(43, "b")}`;
      const {
        target: _target,
        tmdbId: _tmdbId,
        mediaId: _mediaId,
        publishedAt: _publishedAt,
        ...stored
      } = candidate;
      const record = { id, ...stored };
      this.records.set(id, record);
      return record;
    });
  }

  async findById(id: string): Promise<StoredCandidate | null> {
    return this.records.get(id) ?? null;
  }

  async deleteExpired(now: number): Promise<number> {
    let deleted = 0;
    for (const [id, candidate] of this.records) {
      if (candidate.expiresAt <= now) {
        this.records.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }
}

class MemoryDownloadRepository implements DownloadRepository {
  readonly records = new Map<string, DownloadRecord>();

  constructor(private readonly events: string[] = []) {}

  async insert(download: DownloadRecord): Promise<void> {
    if (this.records.has(download.id)) throw new Error("duplicate download");
    this.records.set(download.id, download);
    this.events.push("db:insert");
  }

  async findById(id: string): Promise<DownloadRecord | null> {
    return this.records.get(id) ?? null;
  }

  async listForReconciliation(): Promise<readonly DownloadRecord[]> {
    return [...this.records.values()];
  }

  async transition(
    id: string,
    expectedStates: readonly DownloadState[],
    patch: DownloadPatch,
  ): Promise<DownloadRecord | null> {
    const current = this.records.get(id);
    if (!current || !expectedStates.includes(current.state)) return null;
    const next = { ...current, ...patch };
    this.records.set(id, next);
    if (patch.state) this.events.push(`db:${patch.state}`);
    return next;
  }
}

class FakeIndexer implements IndexerGateway {
  readonly requests: IndexerSearchRequest[] = [];

  constructor(
    private readonly releases: readonly IndexerRelease[],
    private readonly events: string[],
  ) {}

  async search(request: IndexerSearchRequest) {
    this.requests.push(request);
    return {
      offset: 0,
      total: this.releases.length,
      results: this.releases,
    };
  }

  async fetchMetainfo(): Promise<Uint8Array> {
    this.events.push("external:jackett");
    return new Uint8Array([0x64, 0x65]);
  }
}

class FakeTorrentEngine implements TorrentEngine {
  readonly torrents = new Map<string, TorrentSnapshot>();
  readonly added: {
    source: TorrentInput;
    options: AddTorrentOptions | undefined;
  }[] = [];
  returnDuplicate = false;

  constructor(private readonly events: string[]) {}

  async add(
    source: TorrentInput,
    options?: AddTorrentOptions,
  ): Promise<AddedTorrent> {
    this.events.push("external:transmission");
    this.added.push({ source, options });
    const hash =
      "magnetUri" in source && source.magnetUri !== undefined
        ? magnetHash(source.magnetUri)
        : HASH;
    if (!this.returnDuplicate) {
      this.torrents.set(hash, torrent(hash, options?.labels ?? [], false));
    }
    return { hash, name: "Dune", duplicate: this.returnDuplicate };
  }

  async get(hash: string): Promise<TorrentSnapshot | null> {
    return this.torrents.get(hash) ?? null;
  }

  async list(): Promise<readonly TorrentSnapshot[]> {
    return [...this.torrents.values()];
  }

  async selectFiles(): Promise<void> {}

  async start(hash: string): Promise<void> {
    const existing = this.torrents.get(hash);
    if (existing)
      this.torrents.set(hash, { ...existing, status: "downloading" });
  }

  async pause(hash: string): Promise<void> {
    const existing = this.torrents.get(hash);
    if (existing) this.torrents.set(hash, { ...existing, status: "stopped" });
  }

  async remove(hash: string): Promise<void> {
    this.torrents.delete(hash);
  }

  complete(hash: string): void {
    const existing = requireValue(this.torrents.get(hash));
    this.torrents.set(hash, torrent(hash, existing.labels, true));
  }
}

class RecordingOrganizer implements LibraryOrganizer {
  readonly requests: unknown[] = [];

  async organize(request: unknown) {
    this.requests.push(request);
    return [];
  }
}

class FlakyOrganizer implements LibraryOrganizer {
  attempts = 0;

  constructor(private failuresRemaining: number) {}

  async organize() {
    this.attempts += 1;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("temporary disk error");
    }
    return [];
  }
}

function release(overrides: Partial<IndexerRelease> = {}): IndexerRelease {
  return {
    id: "release",
    title: "Dune.2021.1080p.WEB-DL.x265-GRP",
    indexer: "example",
    description: null,
    publishedAt: "2026-07-21T10:00:00.000Z",
    sizeBytes: 5_000_000_000,
    seeders: 10,
    peers: 2,
    grabs: 1,
    categories: [2000],
    downloadUrl: null,
    magnetUri: magnet(HASH),
    infoHash: HASH,
    ...overrides,
  };
}

function torrent(
  hash: string,
  labels: readonly string[],
  complete: boolean,
  overrides: Partial<TorrentSnapshot> = {},
): TorrentSnapshot {
  return {
    hash,
    name: "Dune",
    status: complete ? "seeding" : "downloading",
    progress: complete ? 1 : 0.25,
    metadataProgress: 1,
    totalSize: 100,
    sizeWhenDone: 100,
    leftUntilDone: complete ? 0 : 75,
    downloadRate: complete ? 0 : 10,
    uploadRate: 0,
    etaSeconds: complete ? null : 10,
    downloadDirectory: `/downloads/${DOWNLOAD_ID}`,
    labels,
    finished: complete,
    stalled: false,
    error: null,
    files: [
      {
        index: 0,
        name: "Dune.2021.mkv",
        length: 100,
        bytesCompleted: complete ? 100 : 25,
        wanted: true,
        priority: "normal",
      },
    ],
    ...overrides,
  };
}

function magnet(hash: string): string {
  return `magnet:?xt=urn:btih:${hash}`;
}

function magnetHash(value: string): string {
  return value.slice(value.lastIndexOf(":") + 1);
}

function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("missing fixture");
  return value;
}
