import type { IntegrationStatus } from "../../contracts";
import type { SecretVault } from "../auth";
import type { SettingsRepository } from "../db";

import {
  createJackettClient,
  createOmdbClient,
  createTmdbClient,
  createTransmissionClient,
  type JackettClient,
  type OmdbClient,
  type TmdbClient,
  type TorrentEngine,
} from "../integrations";

export type IntegrationKey = "tmdb" | "jackett" | "transmission" | "omdb";

export interface IntegrationResolver {
  tmdb(): Promise<TmdbClient>;
  omdb(): Promise<OmdbClient>;
  jackett(): Promise<JackettClient>;
  transmission(): Promise<TorrentEngine>;
  test(key: IntegrationKey): Promise<IntegrationStatus>;
  status(): Promise<IntegrationStatus[]>;
  invalidate(keys?: readonly IntegrationKey[]): void;
}

export interface IntegrationResolverOptions {
  environment: Record<string, string | undefined>;
  secrets: SecretVault;
  settings: SettingsRepository;
}

export function createIntegrationResolver(
  options: IntegrationResolverOptions,
): IntegrationResolver {
  const statusCache = new Map<
    IntegrationKey,
    { expiresAt: number; value: IntegrationStatus }
  >();
  let transmissionCache:
    | { signature: string; client: TorrentEngine }
    | undefined;
  let omdbCache: { signature: string; client: OmdbClient } | undefined;

  async function tmdb(): Promise<TmdbClient> {
    const configuredAccessToken = nonEmpty(
      options.environment["TMDB_ACCESS_TOKEN"],
    );
    const legacyApiKey = isTmdbV3ApiKey(configuredAccessToken)
      ? configuredAccessToken
      : undefined;
    const accessToken =
      legacyApiKey === undefined ? configuredAccessToken : undefined;
    const apiKey =
      nonEmpty(options.environment["TMDB_API_KEY"]) ??
      legacyApiKey ??
      (await options.secrets.get("tmdb.apiKey"));
    if (accessToken === undefined && apiKey === undefined) {
      throw new IntegrationConfigurationError("tmdb", "TMDB is not configured");
    }
    return createTmdbClient({
      accessToken,
      apiKey,
      baseUrl:
        options.environment["NODE_ENV"] === "test"
          ? nonEmpty(options.environment["BOBARR_TMDB_URL"])
          : undefined,
    });
  }

  async function jackett(): Promise<JackettClient> {
    const apiKey =
      nonEmpty(options.environment["BOBARR_JACKETT_API_KEY"]) ??
      nonEmpty(options.environment["JACKETT_API_KEY"]) ??
      (await options.secrets.get("jackett.apiKey"));
    if (apiKey === undefined) {
      throw new IntegrationConfigurationError(
        "jackett",
        "Jackett API key is not configured",
      );
    }
    const settings = options.settings.ensureDefaults().settings;
    return createJackettClient({
      apiKey,
      baseUrl:
        nonEmpty(options.environment["BOBARR_JACKETT_URL"]) ??
        settings.integrations.jackettUrl,
      timeoutMs: 20_000,
    });
  }

  async function omdb(): Promise<OmdbClient> {
    const apiKey =
      nonEmpty(options.environment["OMDB_API_KEY"]) ??
      (await options.secrets.get("omdb.apiKey"));
    if (apiKey === undefined) {
      throw new IntegrationConfigurationError(
        "omdb",
        "OMDb is optional and not configured",
      );
    }
    const baseUrl =
      nonEmpty(options.environment["BOBARR_OMDB_URL"]) ??
      "https://www.omdbapi.com/";
    const signature = JSON.stringify([baseUrl, apiKey]);
    if (omdbCache?.signature !== signature) {
      omdbCache = {
        signature,
        client: createOmdbClient({ apiKey, baseUrl }),
      };
    }
    return omdbCache.client;
  }

  async function transmission(): Promise<TorrentEngine> {
    const settings = options.settings.ensureDefaults().settings;
    const rpcUrl =
      nonEmpty(options.environment["BOBARR_TRANSMISSION_URL"]) ??
      settings.integrations.transmissionUrl;
    const username =
      nonEmpty(options.environment["BOBARR_TRANSMISSION_USERNAME"]) ??
      settings.integrations.transmissionUsername;
    const password =
      nonEmpty(options.environment["BOBARR_TRANSMISSION_PASSWORD"]) ??
      (await options.secrets.get("transmission.password"));
    const signature = JSON.stringify([rpcUrl, username, password]);
    if (transmissionCache?.signature !== signature) {
      transmissionCache = {
        signature,
        client: createTransmissionClient({ rpcUrl, username, password }),
      };
    }
    return transmissionCache.client;
  }

  async function probe(key: IntegrationKey): Promise<IntegrationStatus> {
    const label = integrationLabel(key);
    try {
      if (key === "tmdb") {
        await (await tmdb()).popular("movie", { page: 1 });
        return {
          key,
          label,
          configured: true,
          healthy: true,
          message: "Connected",
        };
      }
      if (key === "jackett") {
        await (await jackett()).health();
        return {
          key,
          label,
          configured: true,
          healthy: true,
          message: "Connected",
        };
      }
      if (key === "transmission") {
        const health = await (await transmission()).health();
        return {
          key,
          label,
          configured: true,
          healthy: true,
          message: "Connected",
          version: health.version,
        };
      }

      await (await omdb()).health();
      return {
        key,
        label,
        configured: true,
        healthy: true,
        message: "Connected",
      };
    } catch (error) {
      const configured = !(error instanceof IntegrationConfigurationError);
      return {
        key,
        label,
        configured,
        healthy: false,
        message: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  async function test(key: IntegrationKey): Promise<IntegrationStatus> {
    const value = await probe(key);
    statusCache.set(key, {
      expiresAt: Date.now() + STATUS_CACHE_TTL_MS,
      value,
    });
    return { ...value };
  }

  return {
    tmdb,
    omdb,
    jackett,
    transmission,
    test,
    async status() {
      const now = Date.now();
      return Promise.all(
        INTEGRATION_KEYS.map((key) => {
          const cached = statusCache.get(key);
          return cached !== undefined && cached.expiresAt > now
            ? { ...cached.value }
            : test(key);
        }),
      );
    },
    invalidate(keys = INTEGRATION_KEYS) {
      for (const key of keys) statusCache.delete(key);
    },
  };
}

const INTEGRATION_KEYS = [
  "tmdb",
  "jackett",
  "transmission",
  "omdb",
] as const satisfies readonly IntegrationKey[];
const STATUS_CACHE_TTL_MS = 5 * 60_000;

export class IntegrationConfigurationError extends Error {
  constructor(
    readonly integration: IntegrationKey,
    message: string,
  ) {
    super(message);
    this.name = "IntegrationConfigurationError";
  }
}

function integrationLabel(key: IntegrationKey): string {
  if (key === "tmdb") return "TMDB";
  if (key === "omdb") return "OMDb";
  if (key === "jackett") return "Jackett";
  return "Transmission";
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === "" ? undefined : normalized;
}

function isTmdbV3ApiKey(value: string | undefined): value is string {
  return value !== undefined && /^[a-f\d]{32}$/i.test(value);
}
