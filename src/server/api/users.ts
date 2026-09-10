import type { ApiDependencies, ApiEnvironment } from "./app";

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

import {
  requestMetadata,
  setCsrfCookie,
  setSessionCookie,
} from "./session-http";
import {
  AcceptInviteRequestSchema,
  AccountSchema,
  ApiErrorEnvelopeSchema,
  AuthSessionSchema,
  CreateInviteRequestSchema,
  CreatedInviteSchema,
  DeleteUserResponseSchema,
  InviteParamsSchema,
  InvitePreviewQuerySchema,
  InvitePreviewSchema,
  RevokeInviteResponseSchema,
  UpdateUserRankRequestSchema,
  UserParamsSchema,
  UsersResponseSchema,
} from "../../contracts";
import { deriveInviteState } from "../auth";
import { systemClock, toIsoDate } from "../core";
import { toAccount } from "../db";

const errorResponse = {
  content: { "application/json": { schema: ApiErrorEnvelopeSchema } },
  description: "Standard API error",
} as const;

function jsonResponse<TSchema extends z.ZodType>(
  schema: TSchema,
  description: string,
) {
  return {
    content: { "application/json": { schema } },
    description,
  } as const;
}

function jsonBody<TSchema extends z.ZodType>(schema: TSchema) {
  return {
    required: true,
    content: { "application/json": { schema } },
  } as const;
}

const invitePreviewRoute = createRoute({
  method: "get",
  path: "/api/v1/invites/preview",
  tags: ["auth"],
  request: { query: InvitePreviewQuerySchema },
  responses: {
    200: jsonResponse(InvitePreviewSchema, "Open invite preview"),
    default: errorResponse,
  },
});

const acceptInviteRoute = createRoute({
  method: "post",
  path: "/api/v1/invites/accept",
  tags: ["auth"],
  request: { body: jsonBody(AcceptInviteRequestSchema) },
  responses: {
    201: jsonResponse(AuthSessionSchema, "Accepted invite and signed in"),
    default: errorResponse,
  },
});

const listUsersRoute = createRoute({
  method: "get",
  path: "/api/v1/users",
  tags: ["users"],
  security: [{ sessionCookie: [] }],
  responses: {
    200: jsonResponse(UsersResponseSchema, "People and invites"),
    default: errorResponse,
  },
});

const createInviteRoute = createRoute({
  method: "post",
  path: "/api/v1/users/invites",
  tags: ["users"],
  security: [{ sessionCookie: [] }],
  request: { body: jsonBody(CreateInviteRequestSchema) },
  responses: {
    201: jsonResponse(CreatedInviteSchema, "Created invite"),
    default: errorResponse,
  },
});

const revokeInviteRoute = createRoute({
  method: "delete",
  path: "/api/v1/users/invites/{id}",
  tags: ["users"],
  security: [{ sessionCookie: [] }],
  request: { params: InviteParamsSchema },
  responses: {
    200: jsonResponse(RevokeInviteResponseSchema, "Revoked invite"),
    default: errorResponse,
  },
});

const updateUserRankRoute = createRoute({
  method: "patch",
  path: "/api/v1/users/{id}",
  tags: ["users"],
  security: [{ sessionCookie: [] }],
  request: {
    params: UserParamsSchema,
    body: jsonBody(UpdateUserRankRequestSchema),
  },
  responses: {
    200: jsonResponse(AccountSchema, "Updated account rank"),
    default: errorResponse,
  },
});

const deleteUserRoute = createRoute({
  method: "delete",
  path: "/api/v1/users/{id}",
  tags: ["users"],
  security: [{ sessionCookie: [] }],
  request: { params: UserParamsSchema },
  responses: {
    200: jsonResponse(DeleteUserResponseSchema, "Deleted account"),
    default: errorResponse,
  },
});

export function registerUserRoutes(
  app: OpenAPIHono<ApiEnvironment>,
  dependencies: ApiDependencies,
): void {
  const clock = dependencies.clock ?? systemClock;

  app.openapi(invitePreviewRoute, (context) =>
    context.json(
      dependencies.invites.preview(context.req.valid("query").token),
      200,
    ),
  );
  app.openapi(acceptInviteRoute, async (context) => {
    const grant = await dependencies.invites.accept(
      context.req.valid("json"),
      requestMetadata(context.req.raw),
    );
    setSessionCookie(context, dependencies.config, grant.sessionToken);
    setCsrfCookie(context, dependencies.config, grant.response.csrfToken);
    return context.json(grant.response, 201);
  });
  app.openapi(listUsersRoute, (context) => {
    const actor = context.get("auth").actor;
    const users = dependencies.auth.listAccounts(actor);
    const invites = dependencies.invites.listInvites(actor);
    const now = clock.now().getTime();
    return context.json(
      {
        users: users.map(toAccount),
        invites: invites.map((row) => {
          const state = deriveInviteState(row, now);
          return {
            id: row.id,
            status: state.status,
            createdAt: toIsoDate(row.createdAt),
            expiresAt: toIsoDate(row.expiresAt),
            acceptedAt:
              row.acceptedAt === null ? null : toIsoDate(row.acceptedAt),
            revokedAt: row.revokedAt === null ? null : toIsoDate(row.revokedAt),
            acceptedBy: row.acceptedBy,
          };
        }),
      },
      200,
    );
  });
  app.openapi(createInviteRoute, async (context) => {
    const body = context.req.valid("json");
    const invite = await dependencies.invites.create(
      context.get("auth").actor,
      body.expiresInSeconds === undefined
        ? {}
        : { expiresInSeconds: body.expiresInSeconds },
    );
    return context.json(invite, 201);
  });
  app.openapi(revokeInviteRoute, (context) => {
    dependencies.invites.revoke(
      context.get("auth").actor,
      context.req.valid("param").id,
    );
    return context.json({ revoked: true as const }, 200);
  });
  app.openapi(updateUserRankRoute, (context) => {
    const user = dependencies.auth.setRank(
      context.get("auth").actor,
      context.req.valid("param").id,
      context.req.valid("json").rank,
    );
    return context.json(toAccount(user), 200);
  });
  app.openapi(deleteUserRoute, (context) => {
    dependencies.auth.deleteAccount(
      context.get("auth").actor,
      context.req.valid("param").id,
    );
    return context.json({ deleted: true as const }, 200);
  });
}
