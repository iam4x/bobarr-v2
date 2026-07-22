import { z } from "@hono/zod-openapi";

export const MediaKindSchema = z
  .enum(["movie", "series", "season", "episode"])
  .openapi("MediaKind");

export const MonitorPolicySchema = z
  .enum(["none", "selected", "all", "future"])
  .openapi("MonitorPolicy");

export const AcquisitionStateSchema = z
  .enum([
    "unmonitored",
    "missing",
    "searching",
    "queued",
    "downloading",
    "organizing",
    "available",
    "failed",
  ])
  .openapi("AcquisitionState");

export const DownloadStateSchema = z
  .enum([
    "queued",
    "downloading",
    "paused",
    "checking",
    "seeding",
    "organizing",
    "completed",
    "failed",
  ])
  .openapi("DownloadState");

export const OrganizationStrategySchema = z
  .enum(["hardlink", "symlink", "copy", "move"])
  .openapi("OrganizationStrategy");

export type MediaKind = z.infer<typeof MediaKindSchema>;
export type MonitorPolicy = z.infer<typeof MonitorPolicySchema>;
export type AcquisitionState = z.infer<typeof AcquisitionStateSchema>;
export type DownloadState = z.infer<typeof DownloadStateSchema>;
export type OrganizationStrategy = z.infer<typeof OrganizationStrategySchema>;
