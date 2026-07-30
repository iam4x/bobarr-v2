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

export const AdminSchema = z
  .object({
    id: z.number().int().positive(),
    username: UsernameSchema,
    createdAt: IsoDateTimeSchema,
    lastLoginAt: IsoDateTimeSchema.nullable(),
  })
  .openapi("Admin");

export const SetupStatusSchema = z
  .object({
    setupRequired: z.boolean(),
  })
  .openapi("SetupStatus");

export const AuthSessionSchema = z
  .object({
    admin: AdminSchema,
    csrfToken: z.string().min(32),
    expiresAt: IsoDateTimeSchema,
  })
  .openapi("AuthSession");

export const CurrentSessionSchema = z
  .object({
    admin: AdminSchema,
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

export const UpdateAdminCredentialsRequestSchema = z
  .object({
    username: UsernameSchema,
    password: PasswordSchema.optional(),
  })
  .strict()
  .openapi("UpdateAdminCredentialsRequest");

export const UpdateAdminCredentialsResponseSchema = z
  .object({
    username: UsernameSchema,
  })
  .openapi("UpdateAdminCredentialsResponse");

export type SetupRequest = z.infer<typeof SetupRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type UpdateAdminCredentialsRequest = z.infer<
  typeof UpdateAdminCredentialsRequestSchema
>;
export type Admin = z.infer<typeof AdminSchema>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
export type CurrentSession = z.infer<typeof CurrentSessionSchema>;
