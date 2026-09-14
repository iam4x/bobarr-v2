import { unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  ensureMediaLayout,
  extraComposeYaml,
  mediaPathPlan,
  mediaRootsEnv,
  parseHostMediaPaths,
  sameMediaRoot,
} from "../src/server/media-paths";

const repoRoot = resolve(import.meta.dir, "..");
const generatedCompose = join(repoRoot, "compose.media.yml");

const plan = mediaPathPlan(parseHostMediaPaths(process.env));
const primary = plan[0];
if (primary === undefined) {
  throw new Error("BOBARR_MEDIA_PATHS must list at least one host folder");
}
const extra = extraComposeYaml(plan);
const previousPrimary = process.env["BOBARR_MEDIA_PATH"]?.trim();
if (
  previousPrimary &&
  !(await sameMediaRoot(previousPrimary, primary.hostPath))
) {
  throw new Error(
    `BOBARR_MEDIA_PATHS first folder (${primary.hostPath}) is not the current BOBARR_MEDIA_PATH (${previousPrimary}). Put the existing library disk first so it stays mounted at /media.`,
  );
}
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
