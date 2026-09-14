import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  assertPrimaryMediaRootUnchanged,
  ensureMediaLayout,
  extraComposeYaml,
  mediaPathPlan,
  mediaRootsEnv,
  parseHostMediaPaths,
  parseMediaRootsEnv,
  readPrimaryMediaStamp,
  sameMediaRoot,
  volumesForMediaRoots,
  writePrimaryMediaStamp,
} from "./media-paths";

const DEFAULT_VOLUME = {
  id: "default",
  label: "Default",
  downloadsPath: "/media/downloads",
  moviesPath: "/media/movies",
  televisionPath: "/media/tv",
} as const;

describe("parseHostMediaPaths", () => {
  test("splits a comma-separated list", () => {
    expect(
      parseHostMediaPaths({
        BOBARR_MEDIA_PATHS: "/Volumes/nvme_a, /Volumes/nvme_b",
      }),
    ).toEqual(["/Volumes/nvme_a", "/Volumes/nvme_b"]);
  });

  test("falls back to BOBARR_MEDIA_PATH then ./media", () => {
    expect(parseHostMediaPaths({ BOBARR_MEDIA_PATH: "./data" })).toEqual([
      "./data",
    ]);
    expect(parseHostMediaPaths({})).toEqual(["./media"]);
  });

  test("prefers BOBARR_MEDIA_PATHS over BOBARR_MEDIA_PATH", () => {
    expect(
      parseHostMediaPaths({
        BOBARR_MEDIA_PATHS: "/a,/b",
        BOBARR_MEDIA_PATH: "./media",
      }),
    ).toEqual(["/a", "/b"]);
  });
});

describe("media path plan", () => {
  test("maps the first host folder to /media and extras to /media-<name>", () => {
    const plan = mediaPathPlan(["/Volumes/nvme_a", "/Volumes/nvme_b"]);
    expect(plan).toEqual([
      {
        hostPath: "/Volumes/nvme_a",
        containerRoot: "/media",
        name: "nvme_a",
      },
      {
        hostPath: "/Volumes/nvme_b",
        containerRoot: "/media-nvme-b",
        name: "nvme_b",
      },
    ]);
    expect(mediaRootsEnv(plan)).toBe("nvme_a:/media,nvme_b:/media-nvme-b");
  });

  test("does not reuse an extra container root when the second disk changes", () => {
    const withB = mediaPathPlan(["/Volumes/nvme_a", "/Volumes/nvme_b"]);
    const withC = mediaPathPlan(["/Volumes/nvme_a", "/Volumes/nvme_c"]);
    expect(withB[1]?.containerRoot).toBe("/media-nvme-b");
    expect(withC[1]?.containerRoot).toBe("/media-nvme-c");
  });
});

describe("extraComposeYaml", () => {
  test("is omitted for a single disk", () => {
    expect(extraComposeYaml(mediaPathPlan(["./media"]))).toBeNull();
  });

  test("binds extra disks for Bobarr and Transmission downloads", () => {
    const yaml = extraComposeYaml(
      mediaPathPlan(["/Volumes/nvme_a", "/Volumes/nvme_b"]),
    );
    expect(yaml).toContain(
      'BOBARR_MEDIA_ROOTS: "nvme_a:/media,nvme_b:/media-nvme-b"',
    );
    expect(yaml).toContain("source: /Volumes/nvme_b");
    expect(yaml).toContain("target: /media-nvme-b");
    expect(yaml).toContain("create_host_path: false");
    expect(yaml).toContain("target: /media-nvme-b/downloads");
    expect(yaml).not.toContain("/Volumes/nvme_a");
  });
});

describe("volumesForMediaRoots", () => {
  test("keeps the default volume and appends unused roots", () => {
    const volumes = volumesForMediaRoots(
      [DEFAULT_VOLUME],
      parseMediaRootsEnv("nvme_a:/media,nvme_b:/media-nvme-b"),
    );
    expect(volumes).toHaveLength(2);
    expect(volumes[0]).toEqual(DEFAULT_VOLUME);
    expect(volumes[1]).toEqual({
      id: "nvme-b",
      label: "nvme_b",
      downloadsPath: "/media-nvme-b/downloads",
      moviesPath: "/media-nvme-b/movies",
      televisionPath: "/media-nvme-b/tv",
    });
  });

  test("does not duplicate a root that is already configured", () => {
    expect(
      volumesForMediaRoots([DEFAULT_VOLUME], parseMediaRootsEnv("/media")),
    ).toEqual([DEFAULT_VOLUME]);
  });

  test("does not rewrite paths on an existing volume", () => {
    const current = [
      {
        id: "default",
        label: "Library",
        downloadsPath: "/media/downloads",
        moviesPath: "/media/films",
        televisionPath: "/media/shows",
      },
    ];
    expect(
      volumesForMediaRoots(current, parseMediaRootsEnv("nvme_a:/media")),
    ).toEqual(current);
  });
});

describe("ensureMediaLayout", () => {
  test("does not replace a file that occupies the media path", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bobarr-media-"));
    const filePath = join(parent, "not-a-disk");
    await Bun.write(filePath, "keep");
    await expect(ensureMediaLayout(filePath)).rejects.toThrow(
      "not a directory",
    );
    expect(await Bun.file(filePath).text()).toBe("keep");
  });

  test("refuses to create a missing disk root", async () => {
    const missing = join(
      await mkdtemp(join(tmpdir(), "bobarr-media-")),
      "not-mounted",
    );
    await expect(ensureMediaLayout(missing)).rejects.toThrow(
      "Media folder does not exist",
    );
    await expect(stat(missing)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("creates only missing children and leaves existing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "bobarr-media-"));
    await mkdir(join(root, "movies"));
    await Bun.write(join(root, "movies", "keep.mkv"), "library");
    await ensureMediaLayout(root);
    expect(await Bun.file(join(root, "movies", "keep.mkv")).text()).toBe(
      "library",
    );
    expect((await stat(join(root, "downloads"))).isDirectory()).toBe(true);
    expect((await stat(join(root, "tv"))).isDirectory()).toBe(true);
  });

  test("treats a symlink to an existing disk as the same root", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bobarr-media-"));
    const disk = join(parent, "nvme_a");
    const link = join(parent, "storage");
    await mkdir(disk);
    await symlink(disk, link);
    expect(await sameMediaRoot(link, disk)).toBe(true);
    await ensureMediaLayout(link);
    expect((await stat(join(disk, "downloads"))).isDirectory()).toBe(true);
  });

  test("layout on a new disk does not create folders on another disk", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bobarr-media-"));
    const library = join(parent, "nvme_a");
    const extra = join(parent, "nvme_b");
    await mkdir(join(library, "movies"), { recursive: true });
    await mkdir(extra);
    await Bun.write(join(library, "movies", "keep.mkv"), "library");
    await ensureMediaLayout(extra);
    expect(await Bun.file(join(library, "movies", "keep.mkv")).text()).toBe(
      "library",
    );
    await expect(stat(join(library, "downloads"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await stat(join(extra, "downloads"))).isDirectory()).toBe(true);
  });
});

describe("primary media stamp", () => {
  test("allows the same disk and a symlink to it", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bobarr-media-"));
    const disk = join(parent, "nvme_a");
    const link = join(parent, "storage");
    await mkdir(disk);
    await symlink(disk, link);
    await assertPrimaryMediaRootUnchanged(disk, disk);
    await assertPrimaryMediaRootUnchanged(link, disk);
  });

  test("refuses a different first disk", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bobarr-media-"));
    const library = join(parent, "nvme_a");
    const extra = join(parent, "nvme_b");
    await mkdir(library);
    await mkdir(extra);
    await expect(
      assertPrimaryMediaRootUnchanged(extra, library),
    ).rejects.toThrow("library disk");
  });

  test("round-trips the resolved host path", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bobarr-media-"));
    const disk = join(parent, "nvme_a");
    const stamp = join(parent, "compose.media-primary");
    await mkdir(disk);
    await writePrimaryMediaStamp(stamp, disk);
    expect(await readPrimaryMediaStamp(stamp)).toBe(resolve(disk));
  });
});
