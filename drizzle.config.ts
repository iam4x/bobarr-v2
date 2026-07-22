import { defineConfig } from "drizzle-kit";

const databaseUrl =
  process.env["BOBARR_DATABASE_PATH"] ?? "./config/bobarr.sqlite";

export default defineConfig({
  dialect: "sqlite",
  dbCredentials: {
    url: databaseUrl,
  },
  out: "./drizzle",
  schema: "./src/server/db/schema.ts",
  strict: true,
  verbose: true,
});
