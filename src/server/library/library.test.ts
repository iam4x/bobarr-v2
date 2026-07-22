import { afterEach, describe, expect, test } from "bun:test";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deleteRecordedFile } from "./deletion";
import { importRecordedFiles } from "./importer";
import { organizeFile } from "./organizer";
import { episodeLibraryPath, sanitizePathSegment } from "./paths";
import { scanLibrary } from "./scanner";
import { createFilesystemLibraryOrganizer } from "../application/adapters";
import { createRepositories, openBackendDatabase } from "../db";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("safe library organization", () => {
  test("hardlinks a contained file into a sanitized media path", async () => {
    const root = await temporaryRoot();
    const downloads = join(root, "downloads");
    const library = join(root, "library");
    await mkdir(downloads);
    await Bun.write(join(downloads, "video.mkv"), "media");
    const relativeDestination = episodeLibraryPath({
      showTitle: "A/B: Show",
      season: 1,
      episode: 2,
      episodeTitle: "Hello?",
      extension: ".mkv",
    });
    const result = await organizeFile({
      sourceRoot: downloads,
      libraryRoot: library,
      sourcePath: "video.mkv",
      relativeDestination,
      mode: "hardlink",
    });
    expect(result.created).toBe(true);
    expect(await readFile(result.destination, "utf8")).toBe("media");
    expect((await lstat(result.destination)).ino).toBe(
      (await lstat(result.source)).ino,
    );
    expect(sanitizePathSegment("../../bad:name")).not.toContain("/");
  });

  test("rejects source and destination traversal", async () => {
    const root = await temporaryRoot();
    const downloads = join(root, "downloads");
    const library = join(root, "library");
    await mkdir(downloads);
    await Bun.write(join(root, "outside.mkv"), "media");
    await expect(
      organizeFile({
        sourceRoot: downloads,
        libraryRoot: library,
        sourcePath: "../outside.mkv",
        relativeDestination: "Movie/video.mkv",
        mode: "copy",
      }),
    ).rejects.toThrow("escapes the download root");
    await Bun.write(join(downloads, "inside.mkv"), "media");
    await expect(
      organizeFile({
        sourceRoot: downloads,
        libraryRoot: library,
        sourcePath: "inside.mkv",
        relativeDestination: "../escape.mkv",
        mode: "copy",
      }),
    ).rejects.toThrow("escapes its configured root");
  });

  test("does not follow a symlinked destination directory", async () => {
    const root = await temporaryRoot();
    const downloads = join(root, "downloads");
    const library = join(root, "library");
    const outside = join(root, "outside");
    await mkdir(downloads);
    await mkdir(library);
    await mkdir(outside);
    await Bun.write(join(downloads, "inside.mkv"), "media");
    await symlink(outside, join(library, "escaped"), "dir");

    await expect(
      organizeFile({
        sourceRoot: downloads,
        libraryRoot: library,
        sourcePath: "inside.mkv",
        relativeDestination: "escaped/nested/video.mkv",
        mode: "copy",
      }),
    ).rejects.toThrow("symlink");
    await expect(access(join(outside, "nested"))).rejects.toThrow();
  });

  test("supports symlink, copy, and move strategies", async () => {
    const root = await temporaryRoot();
    const downloads = join(root, "downloads");
    const library = join(root, "library");
    await mkdir(downloads);
    for (const mode of ["symlink", "copy", "move"] as const) {
      const source = join(downloads, `${mode}.mkv`);
      await Bun.write(source, mode);
      const result = await organizeFile({
        sourceRoot: downloads,
        libraryRoot: library,
        sourcePath: source,
        relativeDestination: `Movie/${mode}.mkv`,
        mode,
      });
      expect(await readFile(result.destination, "utf8")).toBe(mode);
      expect((await lstat(result.destination)).isSymbolicLink()).toBe(
        mode === "symlink",
      );
      if (mode === "move") {
        await expect(access(source)).rejects.toThrow();
      } else {
        await access(source);
      }
    }
  });

  test("recognizes a previously published copy by content", async () => {
    const root = await temporaryRoot();
    const downloads = join(root, "downloads");
    const library = join(root, "library");
    await mkdir(downloads);
    await Bun.write(join(downloads, "video.mkv"), "matching media bytes");
    const request = {
      sourceRoot: downloads,
      libraryRoot: library,
      sourcePath: "video.mkv",
      relativeDestination: "Movie/video.mkv",
      mode: "copy" as const,
    };

    expect((await organizeFile(request)).created).toBe(true);
    const retried = await organizeFile(request);

    expect(retried.created).toBe(false);
    expect(retried.actualMode).toBe("copy");
    await access(join(downloads, "video.mkv"));
  });

  test("treats same-size, different-content copies as collisions", async () => {
    const root = await temporaryRoot();
    const downloads = join(root, "downloads");
    const library = join(root, "library");
    await mkdir(downloads);
    await Bun.write(join(downloads, "video.mkv"), "source");
    await mkdir(join(library, "Movie"), { recursive: true });
    await Bun.write(join(library, "Movie", "video.mkv"), "target");

    await expect(
      organizeFile({
        sourceRoot: downloads,
        libraryRoot: library,
        sourcePath: "video.mkv",
        relativeDestination: "Movie/video.mkv",
        mode: "copy",
      }),
    ).rejects.toThrow("destination already exists");
  });

  test("atomically replaces an existing organized file when explicitly requested", async () => {
    const root = await temporaryRoot();
    const downloads = join(root, "downloads");
    const library = join(root, "library");
    const source = join(downloads, "video.mkv");
    const destination = join(library, "Movie", "video.mkv");
    await mkdir(downloads);
    await mkdir(join(library, "Movie"), { recursive: true });
    await Bun.write(source, "new release bytes");
    await Bun.write(destination, "old release bytes");

    const replaced = await organizeFile({
      sourceRoot: downloads,
      libraryRoot: library,
      sourcePath: "video.mkv",
      relativeDestination: "Movie/video.mkv",
      mode: "hardlink",
      collision: "replace",
    });

    expect(replaced.created).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("new release bytes");
    expect((await lstat(destination)).ino).toBe((await lstat(source)).ino);
  });

  test("finishes a retried move after copy publication but before unlink", async () => {
    const root = await temporaryRoot();
    const downloads = join(root, "downloads");
    const library = join(root, "library");
    const source = join(downloads, "video.mkv");
    const destination = join(library, "Movie", "video.mkv");
    await mkdir(downloads);
    await mkdir(join(library, "Movie"), { recursive: true });
    await Bun.write(source, "matching media bytes");
    await copyFile(source, destination);

    const retried = await organizeFile({
      sourceRoot: downloads,
      libraryRoot: library,
      sourcePath: "video.mkv",
      relativeDestination: "Movie/video.mkv",
      mode: "move",
    });

    expect(retried.created).toBe(false);
    expect(await readFile(destination, "utf8")).toBe("matching media bytes");
    await expect(access(source)).rejects.toThrow();
  });

  test("recognizes a retried move after its source was unlinked", async () => {
    const root = await temporaryRoot();
    const downloads = join(root, "downloads");
    const library = join(root, "library");
    const destination = join(library, "Movie", "video.mkv");
    await mkdir(downloads);
    await mkdir(join(library, "Movie"), { recursive: true });
    await Bun.write(destination, "already moved");

    const retried = await organizeFile({
      sourceRoot: downloads,
      libraryRoot: library,
      sourcePath: "removed-download/video.mkv",
      relativeDestination: "Movie/video.mkv",
      mode: "move",
    });

    expect(retried.created).toBe(false);
    expect(retried.destination).toBe(destination);
  });

  test("rejects a missing move source beneath a symlinked parent", async () => {
    const root = await temporaryRoot();
    const downloads = join(root, "downloads");
    const library = join(root, "library");
    const outside = join(root, "outside");
    await mkdir(downloads);
    await mkdir(outside);
    await mkdir(join(library, "Movie"), { recursive: true });
    await Bun.write(join(library, "Movie", "video.mkv"), "already moved");
    await symlink(outside, join(downloads, "escaped"), "dir");

    await expect(
      organizeFile({
        sourceRoot: downloads,
        libraryRoot: library,
        sourcePath: "escaped/video.mkv",
        relativeDestination: "Movie/video.mkv",
        mode: "move",
      }),
    ).rejects.toThrow("escapes the download root");
  });
});

describe("library scanner", () => {
  test("finds media deterministically and skips symlinks by default", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "Season 01"));
    await Bun.write(join(root, "Season 01", "episode.mkv"), "video");
    await Bun.write(join(root, "notes.txt"), "notes");
    await symlink(
      join(root, "Season 01", "episode.mkv"),
      join(root, "linked.mkv"),
    );
    const files = await scanLibrary({ root });
    expect(files.map(({ relativePath }) => relativePath)).toEqual([
      "Season 01/episode.mkv",
    ]);
  });
});

describe("season pack mapping", () => {
  test("preserves multi-episode identities in organized filenames", async () => {
    const root = await temporaryRoot();
    const downloads = join(root, "downloads");
    const downloadDirectory = join(
      downloads,
      "22222222-2222-4222-8222-222222222222",
    );
    const television = join(root, "tv");
    await mkdir(downloadDirectory, { recursive: true });
    const sourceName = "Example.Show.S01E01E02.1080p.mkv";
    await Bun.write(join(downloadDirectory, sourceName), "video");
    const organizer = createFilesystemLibraryOrganizer({
      downloadsRoot: downloads,
      movieLibraryRoot: join(root, "movies"),
      seriesLibraryRoot: television,
      mode: "copy",
    });

    const organized = await organizer.organize({
      downloadId: "22222222-2222-4222-8222-222222222222",
      downloadDirectory,
      target: {
        kind: "season",
        title: "Example Show",
        year: 2026,
        season: 1,
      },
      torrentName: "Example Show Season 1",
      files: [
        {
          index: 0,
          name: sourceName,
          length: 5,
          bytesCompleted: 5,
          wanted: true,
          priority: "normal",
        },
      ],
    });

    expect(organized).toHaveLength(1);
    expect(organized[0]?.destination).toEndWith(
      "Example Show (2026)/Season 01/Example Show - S01E01-E02.mkv",
    );
  });

  test("rejects an unrelated media file for a single episode", async () => {
    const root = await temporaryRoot();
    const downloads = join(root, "downloads");
    const downloadDirectory = join(
      downloads,
      "22222222-2222-4222-8222-222222222222",
    );
    const sourceName = "Other.Show.S03E07.2160p.mkv";
    await mkdir(downloadDirectory, { recursive: true });
    await Bun.write(join(downloadDirectory, sourceName), "unrelated video");
    const organizer = createFilesystemLibraryOrganizer({
      downloadsRoot: downloads,
      movieLibraryRoot: join(root, "movies"),
      seriesLibraryRoot: join(root, "tv"),
      mode: "copy",
    });

    await expect(
      organizer.organize({
        downloadId: "22222222-2222-4222-8222-222222222222",
        downloadDirectory,
        target: {
          kind: "episode",
          title: "Example Show",
          season: 1,
          episode: 2,
        },
        torrentName: "mismatched release",
        files: [
          {
            index: 0,
            name: sourceName,
            length: 50_000_000_000,
            bytesCompleted: 50_000_000_000,
            wanted: true,
            priority: "normal",
          },
        ],
      }),
    ).rejects.toThrow("contains no matching media files");
    await access(join(downloadDirectory, sourceName));
  });
});

describe("recorded library deletion", () => {
  test("rejects a symlinked parent instead of deleting outside the library", async () => {
    const root = await temporaryRoot();
    const library = join(root, "library");
    const outside = join(root, "outside");
    await mkdir(library);
    await mkdir(outside);
    const outsideFile = join(outside, "keep.mkv");
    await Bun.write(outsideFile, "keep");
    await symlink(outside, join(library, "escaped"), "dir");

    await expect(
      deleteRecordedFile(join(library, "escaped", "keep.mkv"), [library]),
    ).rejects.toThrow("unsafe parent");
    expect(await readFile(outsideFile, "utf8")).toBe("keep");
  });

  test("deletes a contained regular file and a symlink record safely", async () => {
    const root = await temporaryRoot();
    const library = join(root, "library");
    const outside = join(root, "outside.mkv");
    await mkdir(join(library, "Movie"), { recursive: true });
    await Bun.write(outside, "outside");
    const regular = join(library, "Movie", "regular.mkv");
    const linked = join(library, "Movie", "linked.mkv");
    await Bun.write(regular, "regular");
    await symlink(outside, linked, "file");

    await expect(deleteRecordedFile(regular, [library])).resolves.toBe(true);
    await expect(deleteRecordedFile(linked, [library])).resolves.toBe(true);
    await expect(access(regular)).rejects.toThrow();
    await expect(access(linked)).rejects.toThrow();
    expect(await readFile(outside, "utf8")).toBe("outside");
  });

  test("accepts a canonical recorded path beneath a configured root alias", async () => {
    const root = await temporaryRoot();
    const physicalLibrary = join(root, "physical-library");
    const configuredAlias = join(root, "library-alias");
    await mkdir(join(physicalLibrary, "Movie"), { recursive: true });
    await symlink(physicalLibrary, configuredAlias, "dir");
    const aliasedFile = join(configuredAlias, "Movie", "movie.mkv");
    await Bun.write(aliasedFile, "movie");
    const recordedPath = await realpath(aliasedFile);

    await expect(
      deleteRecordedFile(recordedPath, [configuredAlias]),
    ).resolves.toBe(true);
    await expect(access(recordedPath)).rejects.toThrow();
  });
});

describe("existing library import", () => {
  test("adopts a series as season and episode children idempotently", async () => {
    const database = await openBackendDatabase(":memory:");
    try {
      const repositories = createRepositories(database);
      const series = repositories.media.create({
        kind: "series",
        tmdbId: 42,
        parentId: null,
        seasonNumber: null,
        episodeNumber: null,
        title: "Example Show",
        year: 2026,
        posterUrl: null,
        status: "available",
        monitorPolicy: "none",
        releaseDate: null,
        metadata: { imported: true },
      });
      const files = [
        { path: "/media/tv/Example/Example.S01E01.mkv", sizeBytes: 10 },
        { path: "/media/tv/Example/Example.S01E02E03.mkv", sizeBytes: 20 },
      ];

      importRecordedFiles({ media: series, files, repositories });
      importRecordedFiles({ media: series, files, repositories });

      const seasons = repositories.media.children(series.id);
      expect(seasons).toHaveLength(1);
      expect(seasons[0]).toMatchObject({
        kind: "season",
        seasonNumber: 1,
        acquisitionState: "available",
      });
      const episodes = repositories.media.children(seasons[0]!.id);
      expect(episodes.map((episode) => episode.episodeNumber)).toEqual([
        1, 2, 3,
      ]);
      expect(
        repositories.libraryFiles.listForMedia(episodes[0]!.id),
      ).toHaveLength(1);
      expect(
        repositories.libraryFiles.listForMedia(seasons[0]!.id),
      ).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});

async function temporaryRoot(): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), "bobarr-library-")));
  temporaryDirectories.push(path);
  return path;
}
