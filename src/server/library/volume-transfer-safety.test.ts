import type { GroupInventory } from "./volume-inventory";

import { afterEach, expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  unlink,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createVolumeOrganizer } from "./volume-organizer";
import { buildVolumeTransfer, resumeVolumeTransfer } from "./volume-transfer";
import { CreateLibraryItemRequestSchema } from "../../contracts";
import { createEncryptionKey } from "../config";
import { createRepositories, openBackendDatabase } from "../db";
import {
  activeVolumeTransfers,
  saveVolumeTransfer,
} from "../db/volume-transfers";
import { STORAGE_RESERVE_BYTES } from "../storage";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test("published copies never authorize deletion of newer source contents", async () => {
  const fixture = await createFixture();
  let changed = false;
  await expect(
    fixture.resume(async () => {
      if (!changed && fixture.transfer.stage === "published") {
        changed = true;
        await fixture.changeSource();
      }
    }),
  ).rejects.toThrow("contents do not match");
  expect(await Bun.file(fixture.source).text()).toBe("new-content");
  expect(await Bun.file(fixture.destination).text()).toBe("old-content");
  expect(activeVolumeTransfers(fixture.database)).toHaveLength(1);
});

test("resumed staged copies must still match current source contents", async () => {
  const fixture = await createFixture();
  await expect(
    fixture.resume(async () => {
      if (
        fixture.transfer.stage === "copying" &&
        fixture.transfer.files[0]?.checksum
      )
        throw new Error("Interrupted after copying");
    }),
  ).rejects.toThrow("Interrupted after copying");
  await fixture.changeSource();
  const recovered = activeVolumeTransfers(fixture.database)[0]!;
  await expect(
    resumeVolumeTransfer({ ...fixture.options, transfer: recovered }),
  ).rejects.toThrow("contents do not match");
  expect(await Bun.file(fixture.source).text()).toBe("new-content");
  expect(fixture.repositories.libraryFiles.get(fixture.fileId)?.path).toBe(
    fixture.source,
  );
});

test("destination corruption after database commit retains the original", async () => {
  const fixture = await createFixture();
  let changed = false;
  await expect(
    fixture.resume(async () => {
      if (!changed && fixture.transfer.stage === "committed") {
        changed = true;
        await Bun.write(fixture.destination, "bad-content");
      }
    }),
  ).rejects.toThrow("verification failure");
  expect(await Bun.file(fixture.source).text()).toBe("old-content");
  expect(fixture.transfer.stage).toBe("committed");
  await Bun.write(fixture.destination, "old-content");
  await fixture.resume();
  await expect(lstat(fixture.source)).rejects.toThrow();
  expect(await Bun.file(fixture.destination).text()).toBe("old-content");
});

test.each([
  { replacement: "old-content", modifiedAt: 1_700_000_000, matching: true },
  { replacement: "old-content", modifiedAt: 1_800_000_000, matching: true },
  { replacement: "new-content", modifiedAt: 1_700_000_000, matching: false },
])(
  "CLI cleanup uses SHA-256 for a replaced source with contents $replacement and mtime $modifiedAt",
  async ({ replacement, modifiedAt, matching }) => {
    const fixture = await createFixture();
    const events: string[] = [];
    let interrupted = false;
    await expect(
      fixture.resume(async () => {
        if (!interrupted && fixture.transfer.stage === "committed") {
          interrupted = true;
          throw new Error("Interrupted after commit");
        }
      }),
    ).rejects.toThrow("Interrupted after commit");
    await rename(fixture.source, `${fixture.source}.external-original`);
    await Bun.write(fixture.source, replacement);
    await utimes(fixture.source, modifiedAt, modifiedAt);
    await resumeVolumeTransfer({
      ...fixture.options,
      transfer: fixture.transfer,
      retainChangedCommittedSources: true,
      progress: (event) => {
        if (event.kind === "file") events.push(event.action);
      },
    });
    if (matching) {
      expect(events).toContain("source-reverified");
      expect(events).toContain("source-removed");
      await expect(lstat(fixture.source)).rejects.toThrow();
    } else {
      expect(events).toContain("source-retained");
      expect(events).not.toContain("source-removed");
      expect(await Bun.file(fixture.source).text()).toBe(replacement);
    }
    expect(await Bun.file(`${fixture.source}.external-original`).text()).toBe(
      "old-content",
    );
    expect(await Bun.file(fixture.destination).text()).toBe("old-content");
    expect(fixture.repositories.libraryFiles.get(fixture.fileId)?.path).toBe(
      fixture.destination,
    );
    expect(activeVolumeTransfers(fixture.database)).toHaveLength(0);
  },
);

test("job cleanup also accepts a new inode when SHA-256 matches", async () => {
  const fixture = await createFixture();
  await expect(
    fixture.resume(async () => {
      if (fixture.transfer.stage === "committed")
        throw new Error("Interrupted after commit");
    }),
  ).rejects.toThrow("Interrupted after commit");
  await rename(fixture.source, `${fixture.source}.external-original`);
  await Bun.write(fixture.source, "old-content");
  await fixture.resume();
  await expect(lstat(fixture.source)).rejects.toThrow();
  expect(await Bun.file(fixture.destination).text()).toBe("old-content");
  expect(activeVolumeTransfers(fixture.database)).toHaveLength(0);
});

test("job cleanup still blocks removal when replacement bytes differ", async () => {
  const fixture = await createFixture();
  await expect(
    fixture.resume(async () => {
      if (fixture.transfer.stage === "committed")
        throw new Error("Interrupted after commit");
    }),
  ).rejects.toThrow("Interrupted after commit");
  await rename(fixture.source, `${fixture.source}.external-original`);
  await Bun.write(fixture.source, "new-content");
  await expect(fixture.resume()).rejects.toThrow("contents do not match");
  expect(await Bun.file(fixture.source).text()).toBe("new-content");
  expect(await Bun.file(fixture.destination).text()).toBe("old-content");
  expect(activeVolumeTransfers(fixture.database)).toHaveLength(1);
});

test("the CLI inspects a replaced source and cleans matching contents", async () => {
  const fixture = await createFixture();
  await expect(
    fixture.resume(async () => {
      if (fixture.transfer.stage === "committed")
        throw new Error("Interrupted after commit");
    }),
  ).rejects.toThrow("Interrupted after commit");
  await rename(fixture.source, `${fixture.source}.external-original`);
  await Bun.write(fixture.source, "old-content");
  await utimes(fixture.source, 1_700_000_000, 1_700_000_000);
  fixture.repositories.settings.ensureDefaults();
  fixture.repositories.settings.update({
    storage: { volumes: fixture.volumes, organizationStrategy: "copy" },
  });
  const environment = {
    ...process.env,
    NODE_ENV: "test",
    BOBARR_CONFIG_DIR: dirname(fixture.databasePath),
    BOBARR_DATABASE_PATH: fixture.databasePath,
    BOBARR_MASTER_KEY: createEncryptionKey(),
    PORT: "29999",
  };
  const script = new URL(
    "../../../scripts/organize-volumes.ts",
    import.meta.url,
  ).pathname;
  const inspect = Bun.spawn(["bun", script, "--inspect"], {
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [inspection, inspectError, inspectCode] = await Promise.all([
    new Response(inspect.stdout).text(),
    new Response(inspect.stderr).text(),
    inspect.exited,
  ]);
  if (inspectCode !== 0) throw new Error(inspectError);
  expect(inspection).toContain('"sourceState":"changed"');
  expect(inspection).toContain('"destinationState":"present"');
  const run = Bun.spawn(["bun", script, "--resume-only"], {
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, runError, runCode] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ]);
  if (runCode !== 0) throw new Error(`${output}\n${runError}`);
  for (const action of [
    "destination-verification-start",
    "destination-verified",
    "source-reverification-start",
    "source-removal-start",
    "staging-cleanup-start",
    "staging-removed",
  ])
    expect(output).toContain(`"action":"${action}"`);
  expect(output).toContain('"action":"source-reverified"');
  expect(output).toContain('"action":"source-removed"');
  expect(output).toContain('"event":"run.success"');
  await expect(lstat(fixture.source)).rejects.toThrow();
  expect(await Bun.file(`${fixture.source}.external-original`).text()).toBe(
    "old-content",
  );
  expect(await Bun.file(fixture.destination).text()).toBe("old-content");
  expect(activeVolumeTransfers(fixture.database)).toHaveLength(0);
});

test("cleanup preserves a new source created after the original was retired", async () => {
  const fixture = await createFixture();
  await expect(
    fixture.resume(async () => {
      if (fixture.transfer.stage === "committed")
        throw new Error("Interrupted after commit");
    }),
  ).rejects.toThrow("Interrupted after commit");
  const retirement = fixture.transfer.files[0]!.retirementPath;
  await mkdir(dirname(retirement), { recursive: true });
  await rename(fixture.source, retirement);
  await Bun.write(fixture.source, "new-content");
  const events: string[] = [];
  await resumeVolumeTransfer({
    ...fixture.options,
    transfer: fixture.transfer,
    retainChangedCommittedSources: true,
    progress: (event) => {
      if (event.kind === "file") events.push(event.action);
    },
  });
  expect(events).toContain("source-retained");
  expect(await Bun.file(fixture.source).text()).toBe("new-content");
  expect(await Bun.file(fixture.destination).text()).toBe("old-content");
  await expect(lstat(retirement)).rejects.toThrow();
});

test("a failed journal commit cannot advance the live transfer to cleanup", async () => {
  const fixture = await createFixture();
  fixture.database.sqlite.exec(`
    CREATE TRIGGER reject_committed_transfer BEFORE UPDATE OF stage ON volume_transfers
    WHEN NEW.stage = 'committed' BEGIN SELECT RAISE(ABORT, 'Journal commit failed'); END;
  `);
  await expect(fixture.resume()).rejects.toThrow("Journal commit failed");
  expect(fixture.transfer.stage).toBe("published");
  expect(activeVolumeTransfers(fixture.database)[0]?.stage).toBe("published");
  expect(fixture.repositories.libraryFiles.get(fixture.fileId)?.path).toBe(
    fixture.source,
  );
  expect(await Bun.file(fixture.source).text()).toBe("old-content");
  fixture.database.sqlite.exec("DROP TRIGGER reject_committed_transfer");
  await fixture.resume();
  expect(fixture.repositories.libraryFiles.get(fixture.fileId)?.path).toBe(
    fixture.destination,
  );
  expect(await Bun.file(fixture.destination).text()).toBe("old-content");
  await expect(lstat(fixture.source)).rejects.toThrow();
});

test("incomplete staging attempts survive retry and are reported in Activity", async () => {
  const fixture = await createFixture();
  const file = fixture.transfer.files[0]!;
  const incomplete = file.stagingPath;
  await mkdir(dirname(incomplete), { recursive: true });
  await Bun.write(incomplete, "partial");
  fixture.repositories.settings.ensureDefaults();
  fixture.repositories.settings.update({
    storage: { volumes: fixture.volumes, organizationStrategy: "copy" },
  });
  await createVolumeOrganizer({
    ...fixture.options,
    repositories: fixture.repositories,
    integrations: { transmission: fixture.options.transmission },
  }).organize({ ...fixture.options, jobId: "test" });
  expect(await Bun.file(incomplete).text()).toBe("partial");
  expect(await Bun.file(fixture.destination).text()).toBe("old-content");
  expect(activeVolumeTransfers(fixture.database)).toHaveLength(0);
  const events = fixture.repositories.activity.list({
    offset: 0,
    limit: 20,
  }).events;
  const retained = events.find(
    (event) => event.type === "library.organize.retained",
  );
  expect(retained?.message).toContain(incomplete);
  expect(retained?.data).toEqual({ paths: [incomplete] });
  expect(
    events.find((event) => event.type === "library.organize.completed")?.level,
  ).toBe("warning");
  await expect(lstat(fixture.source)).rejects.toThrow();
});

test("retry capacity includes the full new copy while retaining partial data", async () => {
  const fixture = await createFixture();
  const file = fixture.transfer.files[0]!;
  await mkdir(dirname(file.stagingPath), { recursive: true });
  await Bun.write(file.stagingPath, "partial");
  await expect(
    resumeVolumeTransfer({
      ...fixture.options,
      transfer: fixture.transfer,
      measureFreeBytes: async () => STORAGE_RESERVE_BYTES + 4n,
    }),
  ).rejects.toThrow("Not enough free space");
  expect(await Bun.file(file.stagingPath).text()).toBe("partial");
  expect(await Bun.file(fixture.source).text()).toBe("old-content");
  await expect(lstat(fixture.destination)).rejects.toThrow();
});

test("a replaced staging entry is preserved during committed cleanup", async () => {
  const fixture = await createFixture();
  const file = fixture.transfer.files[0]!;
  let changed = false;
  await expect(
    fixture.resume(async () => {
      if (!changed && fixture.transfer.stage === "committed") {
        changed = true;
        await unlink(file.stagingPath);
        await Bun.write(file.stagingPath, "unrelated data");
      }
    }),
  ).rejects.toThrow("contents do not match");
  expect(await Bun.file(file.stagingPath).text()).toBe("unrelated data");
  expect(await Bun.file(fixture.destination).text()).toBe("old-content");
  expect(fixture.transfer.stage).toBe("committed");
});

test("cleanup resumes a staging entry captured before interruption", async () => {
  const fixture = await createFixture();
  const file = fixture.transfer.files[0]!;
  const retirementPath = `${file.stagingPath}.source`;
  await expect(
    fixture.resume(async () => {
      if (fixture.transfer.stage === "committed") {
        await rename(file.stagingPath, retirementPath);
        throw new Error("Interrupted after staging capture");
      }
    }),
  ).rejects.toThrow("Interrupted after staging capture");
  const recovered = activeVolumeTransfers(fixture.database)[0]!;
  await resumeVolumeTransfer({ ...fixture.options, transfer: recovered });
  await expect(lstat(retirementPath)).rejects.toThrow();
  expect(await Bun.file(fixture.destination).text()).toBe("old-content");
  expect(recovered.stage).toBe("complete");
});

async function createFixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "bobarr-transfer-safety-")),
  );
  const database = await openBackendDatabase(join(root, "bobarr.sqlite"));
  cleanups.push(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });
  const repositories = createRepositories(database);
  const volumes = ["a", "b"].map((id) => ({
    id,
    label: id,
    downloadsPath: join(root, id, "downloads"),
    moviesPath: join(root, id, "movies"),
    televisionPath: join(root, id, "tv"),
  }));
  for (const volume of volumes)
    for (const path of [
      volume.downloadsPath,
      volume.moviesPath,
      volume.televisionPath,
    ])
      await mkdir(path, { recursive: true });
  const first = volumes[0]!;
  const second = volumes[1]!;
  const source = join(first.moviesPath, "Movie/video.mkv");
  const destination = join(second.moviesPath, "Movie/video.mkv");
  await mkdir(dirname(source));
  await Bun.write(source, "old-content");
  await utimes(source, 1_700_000_000, 1_700_000_000);
  const identity = await lstat(source);
  const movie = repositories.media.create(
    CreateLibraryItemRequestSchema.parse({ kind: "movie", title: "Movie" }),
  );
  const file = repositories.libraryFiles.upsert({
    mediaId: movie.id,
    downloadId: null,
    path: source,
    sizeBytes: identity.size,
    strategy: "copy",
    quality: null,
    videoCodec: null,
    audioCodec: null,
  });
  const key = `movie:${movie.id}`;
  const group: GroupInventory = {
    key,
    groups: [
      {
        key,
        kind: "movie",
        mediaIds: [movie.id],
        seriesId: null,
        seasonNumber: null,
      },
    ],
    title: movie.title,
    mediaIds: [movie.id],
    files: [
      {
        path: source,
        root: first.moviesPath,
        volumeId: first.id,
        identity: {
          dev: identity.dev,
          ino: identity.ino,
          size: identity.size,
          mtimeMs: identity.mtimeMs,
          link: null,
        },
      },
    ],
    libraryFiles: [file],
    downloads: [],
    directories: [dirname(source)],
    bytesByVolume: new Map([[first.id, BigInt(identity.size)]]),
  };
  const measureFreeBytes = async () => 1024n ** 4n;
  const transfer = await buildVolumeTransfer({
    group,
    volumes,
    destination: second,
    jobId: "test",
    measureFreeBytes,
  });
  saveVolumeTransfer(database, transfer);
  const options = {
    database,
    signal: new AbortController().signal,
    measureFreeBytes,
    heartbeat: async () => undefined,
    transmission: async (): Promise<never> => {
      throw new Error("Unexpected Transmission call");
    },
  };
  return {
    database,
    databasePath: join(root, "bobarr.sqlite"),
    repositories,
    volumes: [first, second] satisfies [typeof first, typeof second],
    transfer,
    options,
    source,
    destination,
    fileId: file.id,
    resume: (heartbeat = options.heartbeat) =>
      resumeVolumeTransfer({ ...options, transfer, heartbeat }),
    changeSource: async () => {
      await Bun.write(source, "new-content");
      await utimes(source, 1_700_000_000, 1_700_000_000);
    },
  };
}
