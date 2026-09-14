import { unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  assertPrimaryMediaRootUnchanged,
  ensureMediaLayout,
  extraComposeYaml,
  mediaPathPlan,
  mediaRootsEnv,
  parseHostMediaPaths,
  readPrimaryMediaStamp,
  writePrimaryMediaStamp,
} from "../src/server/media-paths";

const repoRoot = resolve(import.meta.dir, "..");
const generatedCompose = join(repoRoot, "compose.media.yml");
const primaryStamp = join(repoRoot, "compose.media-primary");

const plan = mediaPathPlan(parseHostMediaPaths(process.env));
const primary = plan[0];
if (primary === undefined) {
  throw new Error("BOBARR_MEDIA_PATHS must list at least one host folder");
}
const extra = extraComposeYaml(plan);
const previousPrimary =
  process.env["BOBARR_MEDIA_PATH"]?.trim() ||
  (await readPrimaryMediaStamp(primaryStamp));
await assertPrimaryMediaRootUnchanged(primary.hostPath, previousPrimary);
process.env["BOBARR_MEDIA_PATH"] = primary.hostPath;
process.env["BOBARR_MEDIA_ROOTS"] = mediaRootsEnv(plan);

for (const item of plan) {
  await ensureMediaLayout(item.hostPath);
}

if (extra === null) {
  await unlink(generatedCompose).catch(() => undefined);
} else {
  await Bun.write(generatedCompose, extra);
}
await writePrimaryMediaStamp(primaryStamp, primary.hostPath);

const userArgs = process.argv.slice(2);
const files = ["-f", join(repoRoot, "compose.yml")];
if (extra !== null) files.push("-f", generatedCompose);

const docker = Bun.spawn(["docker", "compose", ...files, ...userArgs], {
  cwd: repoRoot,
  env: process.env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await docker.exited);
