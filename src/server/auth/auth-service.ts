import type {
  AuthSession,
  CurrentSession,
  LoginRequest,
  SetupRequest,
  UpdateAdminCredentialsRequest,
} from "../../contracts";
import type { BackendConfig } from "../config";
import type { Clock } from "../core";
import type { AuthRepository, AuthenticatedSessionRecord } from "../db";

import { bunPasswordHasher, type PasswordHasher } from "./passwords";
import {
  AppError,
  constantTimeEqual,
  createOpaqueToken,
  hashOpaqueToken,
  systemClock,
  toIsoDate,
} from "../core";
import { toAdmin } from "../db";

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

export interface SessionGrant {
  sessionToken: string;
  response: AuthSession;
}

export interface AuthenticatedRequest {
  sessionId: string;
  adminId: number;
  current: CurrentSession;
}

export class AuthService {
  private readonly unknownLoginAttempts = new Map<
    string,
    { failures: number; lockedUntil: number }
  >();

  private constructor(
    private readonly repository: AuthRepository,
    private readonly config: BackendConfig,
    private readonly passwordHasher: PasswordHasher,
    private readonly dummyPasswordHash: string,
    private readonly clock: Clock,
    private readonly loginLockEnabled: () => boolean,
  ) {}

  static async create(options: {
    repository: AuthRepository;
    config: BackendConfig;
    passwordHasher?: PasswordHasher;
    clock?: Clock;
    dummyPasswordHash?: string;
    loginLockEnabled?: () => boolean;
  }): Promise<AuthService> {
    const passwordHasher = options.passwordHasher ?? bunPasswordHasher;
    const dummyPasswordHash =
      options.dummyPasswordHash ??
      (await passwordHasher.hash(createOpaqueToken()));
    return new AuthService(
      options.repository,
      options.config,
      passwordHasher,
      dummyPasswordHash,
      options.clock ?? systemClock,
      options.loginLockEnabled ?? (() => true),
    );
  }

  isSetupComplete(): boolean {
    return this.repository.isSetupComplete();
  }

  async setup(
    input: SetupRequest,
    metadata: RequestMetadata = {},
  ): Promise<SessionGrant> {
    if (this.isSetupComplete()) {
      throw new AppError({
        code: "already_configured",
        message: "Bobarr has already been configured",
        status: 409,
      });
    }
    const passwordHash = await this.passwordHasher.hash(input.password);
    const now = this.clock.now().getTime();
    const admin = this.repository.createAdmin(
      input.username,
      passwordHash,
      now,
    );
    this.repository.recordSuccessfulLogin(admin.id, now);
    return this.issueSession(
      this.repository.getAdmin() ?? admin,
      metadata,
      now,
    );
  }

  async login(
    input: LoginRequest,
    metadata: RequestMetadata = {},
  ): Promise<SessionGrant> {
    if (!this.isSetupComplete()) {
      throw new AppError({
        code: "setup_required",
        message: "Complete first-run setup before signing in",
        status: 409,
      });
    }

    const admin = this.repository.getAdminByUsername(input.username);
    const loginLockEnabled = this.loginLockEnabled();
    if (admin === undefined) {
      const now = this.clock.now().getTime();
      const throttleKey = unknownThrottleKey(input.username, metadata);
      const throttle = this.unknownLoginAttempts.get(throttleKey);
      if (loginLockEnabled && throttle && throttle.lockedUntil > now)
        throw accountLocked();
      await this.passwordHasher.verify(input.password, this.dummyPasswordHash);
      if (!loginLockEnabled) throw invalidCredentials();
      const previousFailures =
        throttle && (throttle.lockedUntil === 0 || throttle.lockedUntil > now)
          ? throttle.failures
          : 0;
      const failures = previousFailures + 1;
      const lockedUntil =
        failures >= this.config.loginFailureLimit
          ? now + this.config.loginLockSeconds * 1000
          : 0;
      rememberUnknownFailure(
        this.unknownLoginAttempts,
        throttleKey,
        failures,
        lockedUntil,
        now,
      );
      if (lockedUntil > now) throw accountLocked();
      throw invalidCredentials();
    }

    const now = this.clock.now().getTime();
    if (
      loginLockEnabled &&
      admin.lockedUntil !== null &&
      admin.lockedUntil > now
    ) {
      throw accountLocked();
    }

    const valid = await this.passwordHasher.verify(
      input.password,
      admin.passwordHash,
    );
    if (!valid) {
      if (!loginLockEnabled) throw invalidCredentials();
      const failure = this.repository.recordFailedLogin(
        admin.id,
        this.config.loginFailureLimit,
        now + this.config.loginLockSeconds * 1000,
        now,
      );
      if (failure.lockedUntil !== null && failure.lockedUntil > now)
        throw accountLocked();
      throw invalidCredentials();
    }

    this.repository.recordSuccessfulLogin(admin.id, now);
    const refreshedAdmin = this.repository.getAdmin() ?? admin;
    return this.issueSession(refreshedAdmin, metadata, now);
  }

  authenticate(
    sessionToken: string | undefined,
    options: { csrfToken?: string; requireCsrf?: boolean } = {},
  ): AuthenticatedRequest {
    if (sessionToken === undefined || sessionToken.length < 32)
      throw invalidSession();
    const record = this.repository.getSessionByTokenHash(
      hashOpaqueToken(sessionToken),
    );
    if (record === undefined) throw invalidSession();

    const now = this.clock.now().getTime();
    if (record.session.revokedAt !== null || record.session.expiresAt <= now) {
      if (record.session.revokedAt === null)
        this.repository.revokeSession(record.session.id, now);
      throw invalidSession();
    }

    if (options.requireCsrf === true) {
      const suppliedHash =
        options.csrfToken === undefined
          ? ""
          : hashOpaqueToken(options.csrfToken);
      if (!constantTimeEqual(record.session.csrfHash, suppliedHash)) {
        throw new AppError({
          code: "forbidden",
          message: "A valid CSRF token is required",
          status: 403,
        });
      }
    }

    if (now - record.session.lastSeenAt >= 60_000) {
      this.repository.touchSession(record.session.id, now);
    }
    return this.toAuthenticatedRequest(record);
  }

  logout(sessionId: string): void {
    this.repository.revokeSession(sessionId, this.clock.now().getTime());
  }

  resetLoginLock(adminId: number): void {
    this.repository.resetLoginLock(adminId, this.clock.now().getTime());
    this.unknownLoginAttempts.clear();
  }

  async updateAdminCredentials(
    adminId: number,
    input: UpdateAdminCredentialsRequest,
  ): Promise<{ username: string }> {
    const passwordHash =
      input.password === undefined
        ? undefined
        : await this.passwordHasher.hash(input.password);
    const admin = this.repository.updateAdminCredentials(
      adminId,
      {
        username: input.username,
        ...(passwordHash === undefined ? {} : { passwordHash }),
      },
      this.clock.now().getTime(),
    );
    this.unknownLoginAttempts.clear();
    return { username: admin.username };
  }

  private issueSession(
    admin: NonNullable<ReturnType<AuthRepository["getAdmin"]>>,
    metadata: RequestMetadata,
    now: number,
  ): SessionGrant {
    this.repository.deleteExpiredSessions(now);
    const sessionToken = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const expiresAt = now + this.config.sessionTtlSeconds * 1000;
    this.repository.createSession({
      id: crypto.randomUUID(),
      adminId: admin.id,
      tokenHash: hashOpaqueToken(sessionToken),
      csrfHash: hashOpaqueToken(csrfToken),
      createdAt: now,
      expiresAt,
      userAgent: metadata.userAgent?.slice(0, 500) ?? null,
      ipAddress: metadata.ipAddress?.slice(0, 100) ?? null,
    });
    return {
      sessionToken,
      response: {
        admin: toAdmin(admin),
        csrfToken,
        expiresAt: toIsoDate(expiresAt),
      },
    };
  }

  private toAuthenticatedRequest(
    record: AuthenticatedSessionRecord,
  ): AuthenticatedRequest {
    return {
      sessionId: record.session.id,
      adminId: record.admin.id,
      current: {
        admin: toAdmin(record.admin),
        expiresAt: toIsoDate(record.session.expiresAt),
      },
    };
  }
}

function invalidCredentials(): AppError {
  return new AppError({
    code: "unauthorized",
    message: "Invalid username or password",
    status: 401,
  });
}

function invalidSession(): AppError {
  return new AppError({
    code: "unauthorized",
    message: "Sign in to continue",
    status: 401,
  });
}

function accountLocked(): AppError {
  return new AppError({
    code: "account_locked",
    message: "Sign-in is temporarily locked after repeated failures",
    status: 423,
  });
}

function unknownThrottleKey(
  username: string,
  metadata: RequestMetadata,
): string {
  return `${username.trim().toLocaleLowerCase()}\0${metadata.ipAddress ?? "unknown"}`;
}

function rememberUnknownFailure(
  attempts: Map<string, { failures: number; lockedUntil: number }>,
  key: string,
  failures: number,
  lockedUntil: number,
  now: number,
): void {
  if (attempts.size >= 1_000 && !attempts.has(key)) {
    for (const [candidate, value] of attempts) {
      if (value.lockedUntil <= now) attempts.delete(candidate);
    }
    if (attempts.size >= 1_000) attempts.delete(attempts.keys().next().value!);
  }
  attempts.set(key, { failures, lockedUntil });
}
