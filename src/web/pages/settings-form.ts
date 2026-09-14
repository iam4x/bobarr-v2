import type { Messages } from "../i18n/en";
import type { AppSettings } from "../types";

import { z } from "zod";

export function settingsSchema(messages: Messages) {
  return z.object({
    language: z.string().min(2, messages.settings.isoLanguage),
    region: z.string().length(2, messages.settings.twoLetterRegion),
    tmdbApiKey: z.string(),
    omdbApiKey: z.string(),
    jackettUrl: z.string().url(messages.settings.validJackettUrl),
    jackettApiKey: z.string(),
    transmissionUrl: z.string().url(messages.settings.validTransmissionUrl),
    transmissionUsername: z.string(),
    transmissionPassword: z.string(),
    minimumSeeders: z.coerce.number().int().min(0),
    minimumSizeMb: z.union([z.literal(""), z.coerce.number().min(0)]),
    maximumSizeMb: z.union([z.literal(""), z.coerce.number().positive()]),
    requiredTerms: z.string(),
    preferredTerms: z.string(),
    rejectedTerms: z.string(),
    qualityOrder: z.string().min(1, messages.settings.addQuality),
    volumes: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
          label: z.string().trim().min(1).max(100),
          downloadsPath: z
            .string()
            .min(2, messages.settings.absolutePath)
            .startsWith("/", messages.settings.absolutePath),
          moviesPath: z
            .string()
            .min(2, messages.settings.absolutePath)
            .startsWith("/", messages.settings.absolutePath),
          televisionPath: z
            .string()
            .min(2, messages.settings.absolutePath)
            .startsWith("/", messages.settings.absolutePath),
        }),
      )
      .min(1),
    organizationStrategy: z.enum(["hardlink", "symlink", "copy", "move"]),
    searchMissing: z.string().min(1),
    refreshMetadata: z.string().min(1),
    scanLibrary: z.string().min(1),
    backup: z.string().min(1),
    backupRetention: z.coerce.number().int().min(1).max(365),
    loginLockEnabled: z.boolean(),
  });
}

export type SettingsForm = z.input<ReturnType<typeof settingsSchema>>;
export type ParsedSettingsForm = z.output<ReturnType<typeof settingsSchema>>;

export const emptySettings: AppSettings = {
  locale: { language: "en", region: "US" },
  integrations: {
    jackettUrl: "http://jackett:9117",
    transmissionUrl: "http://transmission:9091/transmission/rpc",
  },
  acquisition: {
    minimumSeeders: 3,
    minimumSizeMb: null,
    maximumSizeMb: null,
    requiredTerms: [],
    preferredTerms: [],
    rejectedTerms: [],
    qualityOrder: ["2160p", "1080p", "720p"],
  },
  storage: {
    volumes: [
      {
        id: "default",
        label: "Default",
        downloadsPath: "/media/downloads",
        moviesPath: "/media/movies",
        televisionPath: "/media/tv",
      },
    ],
    organizationStrategy: "hardlink",
  },
  schedules: {
    searchMissing: "0 */6 * * *",
    refreshMetadata: "0 3 * * *",
    scanLibrary: "0 4 * * *",
    backup: "0 2 * * *",
    backupRetention: 14,
  },
  security: {
    loginLockEnabled: true,
  },
};

export function toForm(settings: AppSettings): SettingsForm {
  return {
    language: settings.locale.language,
    region: settings.locale.region,
    tmdbApiKey: settings.integrations.tmdbApiKey ?? "",
    omdbApiKey: settings.integrations.omdbApiKey ?? "",
    jackettUrl: settings.integrations.jackettUrl,
    jackettApiKey: settings.integrations.jackettApiKey ?? "",
    transmissionUrl: settings.integrations.transmissionUrl,
    transmissionUsername: settings.integrations.transmissionUsername ?? "",
    transmissionPassword: settings.integrations.transmissionPassword ?? "",
    minimumSeeders: settings.acquisition.minimumSeeders,
    minimumSizeMb: settings.acquisition.minimumSizeMb ?? "",
    maximumSizeMb: settings.acquisition.maximumSizeMb ?? "",
    requiredTerms: settings.acquisition.requiredTerms.join(", "),
    preferredTerms: settings.acquisition.preferredTerms.join(", "),
    rejectedTerms: settings.acquisition.rejectedTerms.join(", "),
    qualityOrder: settings.acquisition.qualityOrder.join(", "),
    volumes: settings.storage.volumes.map((volume) => ({
      id: volume.id,
      label: volume.label,
      downloadsPath: volume.downloadsPath,
      moviesPath: volume.moviesPath,
      televisionPath: volume.televisionPath,
    })),
    organizationStrategy: settings.storage.organizationStrategy,
    searchMissing: settings.schedules.searchMissing,
    refreshMetadata: settings.schedules.refreshMetadata,
    scanLibrary: settings.schedules.scanLibrary,
    backup: settings.schedules.backup,
    backupRetention: settings.schedules.backupRetention,
    loginLockEnabled: settings.security.loginLockEnabled,
  };
}

function terms(value: string): string[] {
  return value
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
}

function requireVolumes(
  volumes: ParsedSettingsForm["volumes"],
): AppSettings["storage"]["volumes"] {
  const [first, ...rest] = volumes;
  if (first === undefined) {
    throw new Error("At least one storage volume is required");
  }
  return [first, ...rest];
}

export function fromForm(value: ParsedSettingsForm): AppSettings {
  return {
    locale: { language: value.language, region: value.region.toUpperCase() },
    integrations: {
      tmdbApiKey: value.tmdbApiKey || undefined,
      omdbApiKey: value.omdbApiKey || undefined,
      jackettUrl: value.jackettUrl,
      jackettApiKey: value.jackettApiKey || undefined,
      transmissionUrl: value.transmissionUrl,
      transmissionUsername: value.transmissionUsername || undefined,
      transmissionPassword: value.transmissionPassword || undefined,
    },
    acquisition: {
      minimumSeeders: value.minimumSeeders,
      minimumSizeMb: value.minimumSizeMb === "" ? null : value.minimumSizeMb,
      maximumSizeMb: value.maximumSizeMb === "" ? null : value.maximumSizeMb,
      requiredTerms: terms(value.requiredTerms),
      preferredTerms: terms(value.preferredTerms),
      rejectedTerms: terms(value.rejectedTerms),
      qualityOrder: terms(value.qualityOrder),
    },
    storage: {
      volumes: requireVolumes(value.volumes),
      organizationStrategy: value.organizationStrategy,
    },
    schedules: {
      searchMissing: value.searchMissing,
      refreshMetadata: value.refreshMetadata,
      scanLibrary: value.scanLibrary,
      backup: value.backup,
      backupRetention: value.backupRetention,
    },
    security: {
      loginLockEnabled: value.loginLockEnabled,
    },
  };
}
