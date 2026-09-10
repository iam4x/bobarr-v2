import type { BackendConfig } from "../config";

import { setCookie } from "hono/cookie";

export function csrfCookieName(config: BackendConfig): string {
  return `${config.sessionCookieName}_csrf`;
}

export function setSessionCookie(
  context: Parameters<typeof setCookie>[0],
  config: BackendConfig,
  token: string,
): void {
  setCookie(context, config.sessionCookieName, token, {
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: "Strict",
    path: "/",
    maxAge: config.sessionTtlSeconds,
  });
}

export function setCsrfCookie(
  context: Parameters<typeof setCookie>[0],
  config: BackendConfig,
  token: string,
): void {
  setCookie(context, csrfCookieName(config), token, {
    httpOnly: false,
    secure: config.sessionCookieSecure,
    sameSite: "Strict",
    path: "/",
    maxAge: config.sessionTtlSeconds,
  });
}

export function requestMetadata(request: Request): {
  userAgent?: string;
  ipAddress?: string;
} {
  const forwardedFor = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const userAgent = request.headers.get("user-agent") ?? undefined;
  return {
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(forwardedFor === undefined ? {} : { ipAddress: forwardedFor }),
  };
}
