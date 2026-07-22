import { rm } from "node:fs/promises";

import tailwind from "bun-plugin-tailwind";

await rm(new URL("../dist", import.meta.url), {
  force: true,
  recursive: true,
});

const result = await Bun.build({
  entrypoints: [new URL("../src/index.ts", import.meta.url).pathname],
  env: "disable",
  minify: true,
  outdir: new URL("../dist", import.meta.url).pathname,
  plugins: [tailwind],
  sourcemap: "linked",
  target: "bun",
});

if (!result.success) {
  for (const log of result.logs) {
    await Bun.stderr.write(`${log}\n`);
  }

  process.exit(1);
}

await Bun.stdout.write(`Built ${result.outputs.length} Bobarr assets.\n`);
