import { Database } from "bun:sqlite";
import { join } from "node:path";

const databasePath =
  readArgument("--database") ??
  process.env["BOBARR_DATABASE_PATH"] ??
  join(process.env["BOBARR_CONFIG_DIR"] ?? "./config", "bobarr.sqlite");

if (!process.argv.includes("--password-stdin")) {
  throw new TypeError(
    "Pass the new password through standard input and add --password-stdin. " +
      "Passwords on the command line are intentionally unsupported.",
  );
}
if (process.stdin.isTTY) {
  throw new TypeError(
    "Refusing to read a visible terminal. Pipe the password into standard input.",
  );
}

const password = (await Bun.stdin.text()).replace(/\r?\n$/, "");
if (password.length < 12 || password.length > 256) {
  throw new TypeError(
    "The new administrator password must be 12–256 characters",
  );
}

const passwordHash = await Bun.password.hash(password, {
  algorithm: "argon2id",
  memoryCost: 65_536,
  timeCost: 3,
});
const database = new Database(databasePath, { readwrite: true, strict: true });
try {
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const reset = database.transaction(() => {
    const result = database
      .query(
        `UPDATE admins
         SET password_hash = ?1, failed_login_count = 0,
             locked_until = NULL, updated_at = ?2
         WHERE id = 1`,
      )
      .run(passwordHash, Date.now());
    if (result.changes !== 1) {
      throw new Error("No configured administrator exists in this database");
    }
    database.query("DELETE FROM sessions").run();
  });
  reset();
} finally {
  database.close(false);
}

await Bun.stdout.write(
  "Administrator password reset; all existing sessions were revoked.\n",
);

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new TypeError(`${name} requires a value`);
  }
  return value;
}
