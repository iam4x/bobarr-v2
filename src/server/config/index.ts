import { chmod, mkdir, open } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

const booleanFromEnvironment = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return value;
}, z.boolean());

export const BackendConfigSchema = z
  .object({
    environment: z.enum(["development", "test", "production"]),
    version: z.string().min(1),
    databasePath: z.string().min(1),
    encryptionKey: z
      .string()
      .min(1)
      .refine((value) => {
        try {
          return (
            Uint8Array.fromBase64(value, { alphabet: "base64url" })
              .byteLength === 32
          );
        } catch {
          return false;
        }
      }, "Must be a base64url-encoded 32-byte key"),
    sessionCookieName: z.string().regex(/^[A-Za-z0-9_-]+$/),
    sessionTtlSeconds: z
      .number()
      .int()
      .min(300)
      .max(60 * 60 * 24 * 90),
    sessionCookieSecure: z.boolean(),
    loginFailureLimit: z.number().int().min(3).max(20),
    loginLockSeconds: z
      .number()
      .int()
      .min(30)
      .max(60 * 60 * 24),
  })
  .strict();

export type BackendConfig = z.infer<typeof BackendConfigSchema>;

export function parseBackendConfig(
  environment: Record<string, string | undefined> = process.env,
): BackendConfig {
  const nodeEnvironment = environment["NODE_ENV"] ?? "development";
  const configDirectory = environment["BOBARR_CONFIG_DIR"] ?? "./config";
  const sessionCookieSecure = booleanFromEnvironment.parse(
    environment["BOBARR_COOKIE_SECURE"] ??
      (nodeEnvironment === "production" ? "true" : "false"),
  );

  return BackendConfigSchema.parse({
    environment: nodeEnvironment,
    version: environment["BOBARR_VERSION"] ?? "0.1.0",
    databasePath:
      environment["BOBARR_DATABASE_PATH"] ??
      join(configDirectory, "bobarr.sqlite"),
    encryptionKey:
      environment["BOBARR_MASTER_KEY"] ?? environment["BOBARR_ENCRYPTION_KEY"],
    sessionCookieName: environment["BOBARR_SESSION_COOKIE"] ?? "bobarr_session",
    sessionTtlSeconds: Number(
      environment["BOBARR_SESSION_TTL_SECONDS"] ?? 60 * 60 * 24 * 30,
    ),
    sessionCookieSecure,
    loginFailureLimit: Number(environment["BOBARR_LOGIN_FAILURE_LIMIT"] ?? 5),
    loginLockSeconds: Number(
      environment["BOBARR_LOGIN_LOCK_SECONDS"] ?? 15 * 60,
    ),
  });
}

/** Resolve configuration and create `/config/master.key` on first boot. */
export async function loadBackendConfig(
  environment: Record<string, string | undefined> = process.env,
): Promise<BackendConfig> {
  const configuredKey =
    environment["BOBARR_MASTER_KEY"] ?? environment["BOBARR_ENCRYPTION_KEY"];
  if (configuredKey !== undefined && configuredKey.trim() !== "") {
    return parseBackendConfig({
      ...environment,
      BOBARR_MASTER_KEY: configuredKey.trim(),
    });
  }

  const configDirectory = environment["BOBARR_CONFIG_DIR"] ?? "./config";
  const keyPath = join(configDirectory, "master.key");
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });

  let encryptionKey: string;
  const keyFile = Bun.file(keyPath);
  if (await keyFile.exists()) {
    encryptionKey = (await keyFile.text()).trim();
  } else {
    encryptionKey = createEncryptionKey();
    try {
      const handle = await open(keyPath, "wx", 0o600);
      try {
        await handle.writeFile(`${encryptionKey}\n`, "utf8");
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      encryptionKey = (await Bun.file(keyPath).text()).trim();
    }
  }
  await chmod(keyPath, 0o600);

  return parseBackendConfig({
    ...environment,
    BOBARR_MASTER_KEY: encryptionKey,
  });
}

export function createEncryptionKey(): string {
  return crypto
    .getRandomValues(new Uint8Array(32))
    .toBase64({ alphabet: "base64url", omitPadding: true });
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
