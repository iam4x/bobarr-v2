# Agent Instructions

Default to using Bun instead of Node.js, npm, pnpm, or vite.

Use these repo-specific commands after writing or modifying code:

- Use `bun run test` for testing.
- Use `bun run lint` for linting and TypeScript checks.
- Use `bun run fmt` for formatting.

General command rules:

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`.
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`.
- Use `bun install` instead of `npm install`, `yarn install`, or `pnpm install`.
- Use `bun run <script>` instead of `npm run <script>`, `yarn run <script>`, or `pnpm run <script>`.
- Bun automatically loads `.env`, so don't use `dotenv`.

API and library preferences:

- Use `Bun.serve()` instead of `express`.
- Use `bun:sqlite` for SQLite instead of `better-sqlite3`.
- Use `Bun.redis` for Redis instead of `ioredis`.
- Use `Bun.sql` for Postgres instead of `pg` or `postgres.js`.
- Use the built-in `WebSocket` instead of `ws`.
- Prefer `Bun.file` over `node:fs` `readFile`/`writeFile`.
- Use `Bun.$\`...\``instead of`execa`.

Frontend guidance:

- Prefer Bun-native HTML imports with `Bun.serve()` instead of adding Vite-based solutions.
- Bun HTML imports can load `.tsx`, `.jsx`, `.js`, and CSS directly.

Never use:

- `tsc --noEmit`
- `bun test [single-file]`
