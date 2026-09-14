import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  containerRootForIndex,
  ensureMediaLayout,
  extraComposeYaml,
  mediaPathPlan,
  mediaRootsEnv,
  parseHostMediaPaths,
  parseMediaRootsEnv,
  sameMediaRoot,
  volumesForMediaRoots,
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
  test("maps the first host folder to /media and the next to /media-2", () => {
    const plan = mediaPathPlan(["/Volumes/nvme_a", "/Volumes/nvme_b"]);
    expect(plan).toEqual([
      {
        hostPath: "/Volumes/nvme_a",
        containerRoot: "/media",
        name: "nvme_a",
      },
      {
        hostPath: "/Volumes/nvme_b",
        containerRoot: "/media-2",
        name: "nvme_b",
      },
    ]);
    expect(containerRootForIndex(2)).toBe("/media-3");
    expect(mediaRootsEnv(plan)).toBe("nvme_a:/media,nvme_b:/media-2");
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
      'BOBARR_MEDIA_ROOTS: "nvme_a:/media,nvme_b:/media-2"',
    );
    expect(yaml).toContain("- /Volumes/nvme_b:/media-2");
    expect(yaml).toContain("- /Volumes/nvme_b/downloads:/media-2/downloads");
    expect(yaml).not.toContain("/Volumes/nvme_a:/media");
  });
});

describe("volumesForMediaRoots", () => {
  test("keeps the default volume and appends unused roots", () => {
    const volumes = volumesForMediaRoots(
      [DEFAULT_VOLUME],
      parseMediaRootsEnv("nvme_a:/media,nvme_b:/media-2"),
    );
    expect(volumes).toHaveLength(2);
    expect(volumes[0]).toEqual(DEFAULT_VOLUME);
    expect(volumes[1]).toEqual({
      id: "nvme-b",
      label: "nvme_b",
      downloadsPath: "/media-2/downloads",
      moviesPath: "/media-2/movies",
      televisionPath: "/media-2/tv",
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
});
