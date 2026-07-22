import { z } from "@hono/zod-openapi";

const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .openapi("Sha256");

export const VerifiedBackupSchema = z
  .object({
    name: z.string().regex(/^bobarr-.*\.sqlite$/),
    sizeBytes: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    migrationVersion: z.number().int().positive(),
    sha256: Sha256Schema,
    verified: z.literal(true),
  })
  .openapi("VerifiedBackup");

export const StagedRestoreSchema = z
  .object({
    sizeBytes: z.number().int().positive(),
    stagedAt: z.iso.datetime(),
    migrationVersion: z.number().int().positive(),
    sha256: Sha256Schema,
    restartRequired: z.literal(true),
  })
  .openapi("StagedRestore");

export const BackupRestoreStatusSchema = z
  .object({
    backups: z.array(VerifiedBackupSchema),
    stagedRestore: StagedRestoreSchema.nullable(),
    maxUploadBytes: z.number().int().positive(),
  })
  .openapi("BackupRestoreStatus");

export const CancelStagedRestoreSchema = z
  .object({ cancelled: z.boolean() })
  .openapi("CancelStagedRestore");

export type VerifiedBackup = z.infer<typeof VerifiedBackupSchema>;
export type StagedRestore = z.infer<typeof StagedRestoreSchema>;
export type BackupRestoreStatus = z.infer<typeof BackupRestoreStatusSchema>;
