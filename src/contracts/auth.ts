import { z } from "@hono/zod-openapi";

import { IsoDateTimeSchema } from "./common";

export const UsernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "Use letters, numbers, dots, underscores, or dashes",
  )
  .openapi("Username");

export const PasswordSchema = z.string().min(1).max(256).openapi("Password");

export const SetupRequestSchema = z
  .object({
    username: UsernameSchema.default("admin"),
    password: PasswordSchema,
  })
  .strict()
  .openapi("SetupRequest");

export const LoginRequestSchema = z
  .object({
    username: UsernameSchema,
    password: z.string().min(1).max(256),
  })
  .strict()
  .openapi("LoginRequest");

export const RankSchema = z.enum(["admin", "user"]).openapi("Rank");

export const UiLocaleSchema = z.enum(["en", "fr"]).openapi("UiLocale");

export const AccountSchema = z
  .object({
    id: z.number().int().positive(),
    username: UsernameSchema,
    rank: RankSchema,
    createdAt: IsoDateTimeSchema,
    lastLoginAt: IsoDateTimeSchema.nullable(),
    uiLocale: UiLocaleSchema.nullable(),
  })
  .openapi("Account");

export const ClientCapabilitiesSchema = z
  .object({
    rank: RankSchema,
    canManageSettings: z.boolean(),
  })
  .openapi("ClientCapabilities");

export const SetupStatusSchema = z
  .object({
    setupRequired: z.boolean(),
  })
  .openapi("SetupStatus");

export const AuthSessionSchema = z
  .object({
    user: AccountSchema,
    capabilities: ClientCapabilitiesSchema,
    csrfToken: z.string().min(32),
    expiresAt: IsoDateTimeSchema,
  })
  .openapi("AuthSession");

export const CurrentSessionSchema = z
  .object({
    user: AccountSchema,
    capabilities: ClientCapabilitiesSchema,
    csrfToken: z.string().min(32).optional(),
    expiresAt: IsoDateTimeSchema,
  })
  .openapi("CurrentSession");

export const LogoutResponseSchema = z
  .object({
    loggedOut: z.literal(true),
  })
  .openapi("LogoutResponse");

export const ResetLoginLockResponseSchema = z
  .object({
    reset: z.literal(true),
  })
  .openapi("ResetLoginLockResponse");

export const UpdateCredentialsRequestSchema = z
  .object({
    username: UsernameSchema,
    password: PasswordSchema.optional(),
  })
  .strict()
  .openapi("UpdateCredentialsRequest");

export const UpdateCredentialsResponseSchema = z
  .object({
    username: UsernameSchema,
  })
  .openapi("UpdateCredentialsResponse");

export const UpdateUiLocaleRequestSchema = z
  .object({
    uiLocale: UiLocaleSchema,
  })
  .strict()
  .openapi("UpdateUiLocaleRequest");

export const InvitePreviewSchema = z
  .object({
    status: z.literal("open"),
    expiresAt: IsoDateTimeSchema,
  })
  .openapi("InvitePreview");

export const AcceptInviteRequestSchema = z
  .object({
    token: z.string().min(1).max(256),
    username: UsernameSchema,
    password: PasswordSchema,
  })
  .strict()
  .openapi("AcceptInviteRequest");

export const CreateInviteRequestSchema = z
  .object({
    expiresInSeconds: z
      .number()
      .int()
      .positive()
      .max(30 * 24 * 60 * 60)
      .optional(),
  })
  .strict()
  .openapi("CreateInviteRequest");

export const CreatedInviteSchema = z
  .object({
    id: z.string().uuid(),
    token: z.string().min(32),
    expiresAt: IsoDateTimeSchema,
  })
  .openapi("CreatedInvite");

export const InviteListItemSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(["open", "accepted", "revoked", "expired"]),
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    acceptedAt: IsoDateTimeSchema.nullable(),
    revokedAt: IsoDateTimeSchema.nullable(),
    acceptedBy: z.number().int().positive().nullable(),
  })
  .openapi("InviteListItem");

export const UsersResponseSchema = z
  .object({
    users: z.array(AccountSchema),
    invites: z.array(InviteListItemSchema),
  })
  .openapi("UsersResponse");

export const UserParamsSchema = z
  .object({
    id: z.coerce.number().int().positive(),
  })
  .openapi("UserParams");

export const InviteParamsSchema = z
  .object({
    id: z.string().uuid(),
  })
  .openapi("InviteParams");

export const InvitePreviewQuerySchema = z
  .object({
    token: z.string().min(1).max(256),
  })
  .openapi("InvitePreviewQuery");

export const UpdateUserRankRequestSchema = z
  .object({
    rank: RankSchema,
  })
  .strict()
  .openapi("UpdateUserRankRequest");

export const DeleteUserResponseSchema = z
  .object({
    deleted: z.literal(true),
  })
  .openapi("DeleteUserResponse");

export const RevokeInviteResponseSchema = z
  .object({
    revoked: z.literal(true),
  })
  .openapi("RevokeInviteResponse");

export type SetupRequest = z.infer<typeof SetupRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type UpdateCredentialsRequest = z.infer<
  typeof UpdateCredentialsRequestSchema
>;
export type Account = z.infer<typeof AccountSchema>;
export type Rank = z.infer<typeof RankSchema>;
export type UiLocale = z.infer<typeof UiLocaleSchema>;
export type UpdateUiLocaleRequest = z.infer<typeof UpdateUiLocaleRequestSchema>;
export type ClientCapabilities = z.infer<typeof ClientCapabilitiesSchema>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
export type CurrentSession = z.infer<typeof CurrentSessionSchema>;
export type AcceptInviteRequest = z.infer<typeof AcceptInviteRequestSchema>;
export type CreateInviteRequest = z.infer<typeof CreateInviteRequestSchema>;
export type CreatedInvite = z.infer<typeof CreatedInviteSchema>;
export type InviteListItem = z.infer<typeof InviteListItemSchema>;
export type UsersResponse = z.infer<typeof UsersResponseSchema>;
export type UpdateUserRankRequest = z.infer<typeof UpdateUserRankRequestSchema>;
