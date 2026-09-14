import { afterEach, expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  utimes,
} from "node:fs/promises";
import { join } from "node:path";

import {
  assertMatchingContents,
  copyVerifiedFile,
  removeVerifiedSource,
  retireVerifiedSource,
  type RetainedSource,
} from "./verified-files";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function setup() {
  const root = await realpath(await mkdtemp("/tmp/bobarr-verified-files-"));
  roots.push(root);
  const source = join(root, "original.mkv");
  const destination = join(root, "destination.mkv");
  const retirementPath = join(root, ".retirement", "transfer", "original.mkv");
  await Bun.write(source, "old-content");
  await utimes(source, 1700000000, 1700000000);
  const expectedSource = await lstat(source);
  const checksum = await copyVerifiedFile({ source, destination });
  const input = {
    kind: "file",
    source,
    destination,
    retirementPath,
    checksum,
    expectedSource,
  } satisfies RetainedSource;
  return { root, source, destination, retirementPath, input };
}

test("copies independently, verifies bytes and retains the source", async () => {
  const fixture = await setup();
  expect(await Bun.file(fixture.destination).text()).toBe("old-content");
  expect(await Bun.file(fixture.source).text()).toBe("old-content");
  expect((await lstat(fixture.destination)).ino).not.toBe(
    (await lstat(fixture.source)).ino,
  );
  expect(await assertMatchingContents(fixture.input)).toBe(
    fixture.input.checksum,
  );
});

test("exclusive copying never overwrites an existing destination", async () => {
  const fixture = await setup();
  await Bun.write(fixture.destination, "unrelated data");
  await expect(copyVerifiedFile(fixture)).rejects.toThrow();
  expect(await Bun.file(fixture.destination).text()).toBe("unrelated data");
  expect(await Bun.file(fixture.source).text()).toBe("old-content");
});

test("recreated destination entries are never overwritten", async () => {
  const fixture = await setup();
  await unlink(fixture.destination);
  await Bun.write(fixture.destination, "replacement");
  await expect(copyVerifiedFile(fixture)).rejects.toThrow();
  expect(await Bun.file(fixture.destination).text()).toBe("replacement");
});

test("independent readback rejects corrupt copied bytes", async () => {
  const fixture = await setup();
  const destination = join(fixture.root, "corrupted.mkv");
  await expect(
    copyVerifiedFile({
      ...fixture,
      destination,
      hooks: {
        afterCopy: async () => {
          await Bun.write(destination, "bad-content");
        },
      },
    }),
  ).rejects.toThrow("content verification");
  expect(await Bun.file(fixture.source).text()).toBe("old-content");
});

test("source replacement during copying cannot redirect reads to a symlink target", async () => {
  const fixture = await setup();
  const destination = join(fixture.root, "new-copy.mkv");
  const external = join(fixture.root, "external.mkv");
  await Bun.write(external, "external contents");
  await expect(
    copyVerifiedFile({
      ...fixture,
      destination,
      hooks: {
        afterCopy: async () => {
          await unlink(fixture.source);
          await symlink(external, fixture.source);
        },
      },
    }),
  ).rejects.toThrow("changed");
  expect(await Bun.file(external).text()).toBe("external contents");
  expect(await readlink(fixture.source)).toBe(external);
});

test("same-size source edits with restored timestamps are never deleted", async () => {
  const fixture = await setup();
  await Bun.write(fixture.source, "new-content");
  await utimes(fixture.source, 1700000000, 1700000000);
  await expect(removeVerifiedSource(fixture.input)).rejects.toThrow(
    "do not match",
  );
  expect(await Bun.file(fixture.source).text()).toBe("new-content");
  expect(await Bun.file(fixture.destination).text()).toBe("old-content");
});

test("removes only a captured verified source and resumes completed cleanup", async () => {
  const fixture = await setup();
  await removeVerifiedSource(fixture.input);
  expect(await Bun.file(fixture.source).exists()).toBe(false);
  expect(await Bun.file(fixture.retirementPath).exists()).toBe(false);
  expect(await Bun.file(fixture.destination).text()).toBe("old-content");
  await removeVerifiedSource(fixture.input);
});

test("destination changes preserve the original", async () => {
  const fixture = await setup();
  await Bun.write(fixture.destination, "bad-content");
  await expect(removeVerifiedSource(fixture.input)).rejects.toThrow(
    "do not match",
  );
  expect(await Bun.file(fixture.source).text()).toBe("old-content");
});

test("destination sync failure leaves the original at its original path", async () => {
  const fixture = await setup();
  await expect(
    removeVerifiedSource({
      ...fixture.input,
      hooks: {
        beforeSync: async (path) => {
          if (path === fixture.destination) throw new Error("disk sync failed");
        },
      },
    }),
  ).rejects.toThrow("disk sync failed");
  expect(await Bun.file(fixture.source).text()).toBe("old-content");
  expect(await Bun.file(fixture.retirementPath).exists()).toBe(false);
});

test("replacement during capture retains unexpected bytes for recovery", async () => {
  const fixture = await setup();
  const preserved = join(fixture.root, "preserved-original.mkv");
  await expect(
    removeVerifiedSource({
      ...fixture.input,
      hooks: {
        beforeSourceCapture: async () => {
          await rename(fixture.source, preserved);
          await Bun.write(fixture.source, "unexpected-new-data");
        },
      },
    }),
  ).rejects.toThrow(fixture.retirementPath);
  expect(await Bun.file(fixture.retirementPath).text()).toBe(
    "unexpected-new-data",
  );
  expect(await Bun.file(preserved).text()).toBe("old-content");
  expect(await Bun.file(fixture.destination).text()).toBe("old-content");
});

test("retained copies survive interruption and are removed on retry", async () => {
  const fixture = await setup();
  await retireVerifiedSource(fixture.input);
  expect(await Bun.file(fixture.source).exists()).toBe(false);
  expect(await Bun.file(fixture.retirementPath).text()).toBe("old-content");
  await removeVerifiedSource(fixture.input);
  expect(await Bun.file(fixture.retirementPath).exists()).toBe(false);
  expect(await Bun.file(fixture.destination).text()).toBe("old-content");
});

test("retirement replacement before deletion is retained", async () => {
  const fixture = await setup();
  await expect(
    removeVerifiedSource({
      ...fixture.input,
      hooks: {
        beforeSourceRemoval: async () => {
          await unlink(fixture.retirementPath);
          await Bun.write(fixture.retirementPath, "unexpected-new-data");
        },
      },
    }),
  ).rejects.toThrow("changed");
  expect(await Bun.file(fixture.retirementPath).text()).toBe(
    "unexpected-new-data",
  );
  expect(await Bun.file(fixture.destination).text()).toBe("old-content");
});

test("source symlinks require matching payloads before retirement and deletion", async () => {
  const fixture = await setup();
  const source = join(fixture.root, "library.mkv");
  await symlink("original.mkv", source);
  const expectedSource = await lstat(source);
  const input: RetainedSource = {
    ...fixture.input,
    kind: "symlink",
    source,
    expectedSource,
    linkText: "original.mkv",
    payloadSource: fixture.source,
  };
  await removeVerifiedSource(input);
  expect(await Bun.file(source).exists()).toBe(false);
  expect(await Bun.file(fixture.source).text()).toBe("old-content");
});

test("retained symlinks resume after their original payload was cleaned up", async () => {
  const fixture = await setup();
  const source = join(fixture.root, "library.mkv");
  await symlink("original.mkv", source);
  const input: RetainedSource = {
    ...fixture.input,
    kind: "symlink",
    source,
    expectedSource: await lstat(source),
    linkText: "original.mkv",
    payloadSource: fixture.source,
  };
  await retireVerifiedSource(input);
  await unlink(fixture.source);
  await removeVerifiedSource(input);
  await expect(lstat(fixture.retirementPath)).rejects.toThrow();
  expect(await Bun.file(fixture.destination).text()).toBe("old-content");
});

test("a symlink retirement directory is rejected", async () => {
  const fixture = await setup();
  const external = join(fixture.root, "external");
  await mkdir(external);
  await symlink(external, join(fixture.root, ".retirement"));
  await expect(removeVerifiedSource(fixture.input)).rejects.toThrow(
    "Unsafe retirement",
  );
  expect(await Bun.file(fixture.source).text()).toBe("old-content");
});

test("existing descendants cannot hide a symlink retirement ancestor", async () => {
  const fixture = await setup();
  const external = join(fixture.root, "external");
  await mkdir(join(external, "transfer"), { recursive: true });
  await symlink(external, join(fixture.root, ".retirement"));
  await expect(removeVerifiedSource(fixture.input)).rejects.toThrow(
    "Unsafe retirement",
  );
  expect(await Bun.file(fixture.source).text()).toBe("old-content");
});
