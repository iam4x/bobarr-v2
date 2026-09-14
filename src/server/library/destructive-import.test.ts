import type { OrganizeFileRequest } from "./organizer";

import { afterEach, describe, expect, test } from "bun:test";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { organizeFile } from "./organizer";

const ORIGINAL = "original media bytes";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("verified destructive imports", () => {
  test("copies independently before removing a source on the same filesystem", async () => {
    const fixture = await createFixture();
    const original = await lstat(fixture.source);
    const result = await organizeFile(fixture.request);
    const copied = await lstat(fixture.destination);

    expect(result.created).toBe(true);
    expect(copied.dev).toBe(original.dev);
    expect(copied.ino).not.toBe(original.ino);
    expect(await Bun.file(fixture.destination).text()).toBe(ORIGINAL);
    await expect(lstat(fixture.source)).rejects.toThrow();
  });

  for (const collision of ["error", "replace"] as const) {
    test(`preserves originals when the copied bytes fail verification (${collision})`, async () => {
      const fixture = await createFixture();
      if (collision === "replace")
        await Bun.write(fixture.destination, "previous release");
      await expect(
        organizeFile(
          { ...fixture.request, collision },
          {
            hooks: {
              afterCopy: async () => {
                const copies = (
                  await readdir(dirname(fixture.destination))
                ).filter(
                  (name) =>
                    name.startsWith(
                      `${basename(fixture.destination)}.bobarr-`,
                    ) && name.endsWith(".tmp"),
                );
                expect(copies).toHaveLength(1);
                for (const copy of copies)
                  await Bun.write(
                    join(dirname(fixture.destination), copy),
                    "x".repeat(ORIGINAL.length),
                  );
              },
            },
          },
        ),
      ).rejects.toThrow("content verification");
      expect(await Bun.file(fixture.source).text()).toBe(ORIGINAL);
      if (collision === "replace")
        expect(await Bun.file(fixture.destination).text()).toBe(
          "previous release",
        );
      else await expect(lstat(fixture.destination)).rejects.toThrow();
    });
  }

  test("replaces a matching hardlink with an independent copy before cleanup", async () => {
    const fixture = await createFixture();
    await link(fixture.source, fixture.destination);
    const original = await lstat(fixture.source);

    await organizeFile(fixture.request);

    expect((await lstat(fixture.destination)).ino).not.toBe(original.ino);
    expect(await Bun.file(fixture.destination).text()).toBe(ORIGINAL);
    await expect(lstat(fixture.source)).rejects.toThrow();
  });

  test("retries cleanup after interruption with both verified copies retained", async () => {
    const fixture = await createFixture();
    await expect(
      organizeFile(fixture.request, {
        hooks: {
          beforeSourceRemoval: async () => {
            throw new Error("Interrupted after source capture");
          },
        },
      }),
    ).rejects.toThrow("Interrupted after source capture");
    const retained = await retainedSource(fixture.sourceRoot);
    expect(await Bun.file(retained).text()).toBe(ORIGINAL);
    expect(await Bun.file(fixture.destination).text()).toBe(ORIGINAL);
    await expect(lstat(fixture.source)).rejects.toThrow();

    const retried = await organizeFile(fixture.request);

    expect(retried.created).toBe(false);
    expect(await Bun.file(fixture.destination).text()).toBe(ORIGINAL);
    await expect(lstat(retained)).rejects.toThrow();
  });

  test("retains the source when destination bytes change during cleanup", async () => {
    const fixture = await createFixture();
    await expect(
      organizeFile(fixture.request, {
        hooks: {
          beforeSourceRemoval: async () => {
            await Bun.write(fixture.destination, "x".repeat(ORIGINAL.length));
          },
        },
      }),
    ).rejects.toThrow("contents do not match");
    const retained = await retainedSource(fixture.sourceRoot);
    expect(await Bun.file(retained).text()).toBe(ORIGINAL);
    await expect(organizeFile(fixture.request)).rejects.toThrow(
      "contents do not match",
    );
    expect(await Bun.file(retained).text()).toBe(ORIGINAL);

    await Bun.write(fixture.destination, ORIGINAL);
    await organizeFile(fixture.request);
    await expect(lstat(retained)).rejects.toThrow();
    expect(await Bun.file(fixture.destination).text()).toBe(ORIGINAL);
  });

  test("keeps captured source data recoverable when its destination disappears", async () => {
    const fixture = await createFixture();
    await expect(
      organizeFile(fixture.request, {
        hooks: {
          beforeSourceRemoval: async () => {
            await unlink(fixture.destination);
          },
        },
      }),
    ).rejects.toThrow();
    const retained = await retainedSource(fixture.sourceRoot);
    await expect(organizeFile(fixture.request)).rejects.toThrow(
      "original data is retained",
    );
    expect(await Bun.file(retained).text()).toBe(ORIGINAL);
  });

  test("preserves an incoming file that replaces the source during capture", async () => {
    const fixture = await createFixture();
    const originalBackup = join(fixture.sourceRoot, "original-backup.mkv");
    await expect(
      organizeFile(fixture.request, {
        hooks: {
          beforeSourceCapture: async () => {
            await rename(fixture.source, originalBackup);
            await Bun.write(fixture.source, "incoming replacement");
          },
        },
      }),
    ).rejects.toThrow("retained for recovery");
    const retained = await retainedSource(fixture.sourceRoot);
    expect(await Bun.file(retained).text()).toBe("incoming replacement");
    expect(await Bun.file(originalBackup).text()).toBe(ORIGINAL);
    expect(await Bun.file(fixture.destination).text()).toBe(ORIGINAL);
    await expect(organizeFile(fixture.request)).rejects.toThrow(
      "contents do not match",
    );
    expect(await Bun.file(retained).text()).toBe("incoming replacement");
  });

  test("refuses to delete new source data when resuming a captured move", async () => {
    const fixture = await createFixture();
    await expect(
      organizeFile(fixture.request, {
        hooks: {
          beforeSourceRemoval: async () => {
            await Bun.write(fixture.source, "incoming replacement");
            throw new Error("Interrupted with a new source");
          },
        },
      }),
    ).rejects.toThrow("Interrupted with a new source");
    const retained = await retainedSource(fixture.sourceRoot);
    await expect(organizeFile(fixture.request)).rejects.toThrow(
      "A new source appeared",
    );
    expect(await Bun.file(fixture.source).text()).toBe("incoming replacement");
    expect(await Bun.file(retained).text()).toBe(ORIGINAL);
    expect(await Bun.file(fixture.destination).text()).toBe(ORIGINAL);
  });

  test("refuses a move whose destination is the source itself", async () => {
    const fixture = await createFixture();
    await expect(
      organizeFile({
        ...fixture.request,
        libraryRoot: fixture.sourceRoot,
        relativeDestination: basename(fixture.source),
      }),
    ).rejects.toThrow("separate entries");
    expect(await Bun.file(fixture.source).text()).toBe(ORIGINAL);
  });
});

async function createFixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "bobarr-import-safety-")),
  );
  roots.push(root);
  const sourceRoot = join(root, "downloads");
  const libraryRoot = join(root, "library");
  const source = join(sourceRoot, "video.mkv");
  const destination = join(libraryRoot, "Movie", "video.mkv");
  await mkdir(sourceRoot);
  await mkdir(dirname(destination), { recursive: true });
  await Bun.write(source, ORIGINAL);
  const request: OrganizeFileRequest = {
    sourceRoot,
    libraryRoot,
    sourcePath: source,
    relativeDestination: "Movie/video.mkv",
    mode: "move",
  };
  return { sourceRoot, source, destination, request };
}

async function retainedSource(sourceRoot: string): Promise<string> {
  const directory = join(sourceRoot, ".bobarr-import-retired");
  const retained = await readdir(directory);
  expect(retained).toHaveLength(1);
  const name = retained[0];
  if (!name) throw new Error("Expected a retained source");
  return join(directory, name);
}
