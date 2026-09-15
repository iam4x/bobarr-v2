import { rm } from "node:fs/promises";

import tailwind from "bun-plugin-tailwind";

await rm(new URL("../dist", import.meta.url), {
  force: true,
  recursive: true,
});

const buildOptions = {
  env: "disable",
  minify: true,
  outdir: new URL("../dist", import.meta.url).pathname,
  plugins: [tailwind],
  sourcemap: "linked",
  target: "bun",
} satisfies Omit<Parameters<typeof Bun.build>[0], "entrypoints">;

const server = await Bun.build({
  ...buildOptions,
  entrypoints: [new URL("../src/index.ts", import.meta.url).pathname],
});
const cli = await Bun.build({
  ...buildOptions,
  entrypoints: [new URL("./organize-volumes.ts", import.meta.url).pathname],
});

for (const result of [server, cli]) {
  if (!result.success) {
    for (const log of result.logs) {
      await Bun.stderr.write(`${log}\n`);
    }

    process.exit(1);
  }
}

await Bun.stdout.write(
  `Built ${server.outputs.length + cli.outputs.length} Bobarr assets.\n`,
);
