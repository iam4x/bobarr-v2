import { z } from "@hono/zod-openapi";

import { IsoDateTimeSchema } from "./common";
import { OrganizationStrategySchema } from "./media";

const CronExpressionSchema = z.string().trim().min(5).max(100);
const SecretInputSchema = z.string().max(16_384).optional();

export const StorageVolumeSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    label: z.string().trim().min(1).max(100),
    downloadsPath: z.string().min(2).max(4096).startsWith("/"),
    moviesPath: z.string().min(2).max(4096).startsWith("/"),
    televisionPath: z.string().min(2).max(4096).startsWith("/"),
  })
  .strict()
  .openapi("StorageVolume");

const defaultStorageVolume: z.infer<typeof StorageVolumeSchema> = {
  id: "default",
  label: "Default",
  downloadsPath: "/media/downloads",
  moviesPath: "/media/movies",
  televisionPath: "/media/tv",
};

const StorageSettingsObjectSchema = z
  .object({
    volumes: z.tuple([StorageVolumeSchema], StorageVolumeSchema),
    organizationStrategy: OrganizationStrategySchema.default("hardlink"),
  })
  .strict();

export const StorageSettingsSchema = z.preprocess(
  wrapLegacyStorage,
  StorageSettingsObjectSchema,
);

const defaultStorage: z.infer<typeof StorageSettingsObjectSchema> = {
  volumes: [defaultStorageVolume],
  organizationStrategy: "hardlink",
};

export const AppSettingsSchema = z
  .object({
    locale: z
      .object({
        language: z.string().trim().min(2).max(16).default("en"),
        region: z.string().trim().length(2).default("US"),
      })
      .default({ language: "en", region: "US" }),
    integrations: z
      .object({
        tmdbApiKey: SecretInputSchema,
        omdbApiKey: SecretInputSchema,
        jackettUrl: z.url().default("http://jackett:9117"),
        jackettApiKey: SecretInputSchema,
        transmissionUrl: z
          .url()
          .default("http://transmission:9091/transmission/rpc"),
        transmissionUsername: z.string().trim().max(200).optional(),
        transmissionPassword: SecretInputSchema,
      })
      .default({
        jackettUrl: "http://jackett:9117",
        transmissionUrl: "http://transmission:9091/transmission/rpc",
      }),
    acquisition: z
      .object({
        minimumSeeders: z.number().int().nonnegative().default(3),
        minimumSizeMb: z.number().nonnegative().nullable().default(null),
        maximumSizeMb: z.number().positive().nullable().default(null),
        requiredTerms: z.array(z.string().trim().min(1).max(100)).default([]),
        preferredTerms: z.array(z.string().trim().min(1).max(100)).default([]),
        rejectedTerms: z.array(z.string().trim().min(1).max(100)).default([]),
        qualityOrder: z
          .array(z.string().trim().min(1).max(50))
          .min(1)
          .default(["2160p", "1080p", "720p"]),
      })
      .default({
        minimumSeeders: 3,
        minimumSizeMb: null,
        maximumSizeMb: null,
        requiredTerms: [],
        preferredTerms: [],
        rejectedTerms: [],
        qualityOrder: ["2160p", "1080p", "720p"],
      }),
    storage: StorageSettingsSchema.default(defaultStorage),
    schedules: z
      .object({
        searchMissing: CronExpressionSchema.default("0 */6 * * *"),
        refreshMetadata: CronExpressionSchema.default("0 3 * * *"),
        scanLibrary: CronExpressionSchema.default("0 4 * * *"),
        backup: CronExpressionSchema.default("0 2 * * *"),
        backupRetention: z.number().int().min(1).max(365).default(14),
      })
      .default({
        searchMissing: "0 */6 * * *",
        refreshMetadata: "0 3 * * *",
        scanLibrary: "0 4 * * *",
        backup: "0 2 * * *",
        backupRetention: 14,
      }),
    security: z
      .object({
        loginLockEnabled: z.boolean().default(true),
      })
      .default({
        loginLockEnabled: true,
      }),
  })
  .strict()
  .openapi("AppSettings");

export const UpdateSettingsRequestSchema = AppSettingsSchema.partial()
  .omit({ storage: true })
  .extend({ storage: StorageSettingsSchema.optional() })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one setting is required",
  )
  .openapi("UpdateSettingsRequest");

export const SettingsResponseSchema = z
  .object({
    settings: AppSettingsSchema,
    version: z.number().int().positive(),
    updatedAt: IsoDateTimeSchema,
  })
  .openapi("SettingsResponse");

export const SecretNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-zA-Z0-9._-]*$/, "Invalid secret name")
  .openapi("SecretName");

export const SecretParamsSchema = z
  .object({ name: SecretNameSchema })
  .openapi("SecretParams");

export const SetSecretRequestSchema = z
  .object({ value: z.string().min(1).max(16_384) })
  .strict()
  .openapi("SetSecretRequest");

export const SecretMetadataSchema = z
  .object({
    name: SecretNameSchema,
    configured: z.literal(true),
    updatedAt: IsoDateTimeSchema,
  })
  .openapi("SecretMetadata");

export const SecretListResponseSchema = z
  .object({ secrets: z.array(SecretMetadataSchema) })
  .openapi("SecretListResponse");

export const DeleteSecretResponseSchema = z
  .object({ deleted: z.boolean() })
  .openapi("DeleteSecretResponse");

export type StorageVolume = z.infer<typeof StorageVolumeSchema>;
export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;

function wrapLegacyStorage(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  if (Array.isArray(value["volumes"])) {
    const {
      downloadsPath: _downloadsPath,
      moviesPath: _moviesPath,
      televisionPath: _televisionPath,
      ...rest
    } = value;
    return rest;
  }
  const downloadsPath = value["downloadsPath"];
  const moviesPath = value["moviesPath"];
  const televisionPath = value["televisionPath"];
  if (
    typeof downloadsPath !== "string" ||
    typeof moviesPath !== "string" ||
    typeof televisionPath !== "string"
  ) {
    return value;
  }
  const {
    downloadsPath: _downloadsPath,
    moviesPath: _moviesPath,
    televisionPath: _televisionPath,
    ...rest
  } = value;
  return {
    ...rest,
    volumes: [
      {
        id: "default",
        label: "Default",
        downloadsPath,
        moviesPath,
        televisionPath,
      },
    ],
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;
export type SecretMetadata = z.infer<typeof SecretMetadataSchema>;
