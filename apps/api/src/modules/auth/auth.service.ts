import { HttpException, Inject, Injectable } from "@nestjs/common";
import { UserEntity } from "@arch-flow/db";
import {
  AuthResult,
  ERROR_CODES,
  User,
  type LoginInput,
  type RegisterInput,
} from "@arch-flow/shared";
import { z } from "zod";
import { apiError } from "../../common/api-response.js";
import { loadEnv } from "../../config/env.js";
import { DatabaseService } from "../../database/database.service.js";
import {
  digestCredential,
  hashPassword,
  issueAccessToken,
  newRefreshSession,
  readRefreshIdentity,
  registrationRefreshSession,
  verifyAccessToken,
  verifyPassword,
  type RefreshIdentity,
} from "./auth-credentials.js";
import { REFRESH_LIFETIME_MS, RefreshSessions } from "./refresh-sessions.js";

const REGISTRATION_REPLAY_MS = 24 * 60 * 60 * 1000;
const REGISTRATION_LOCK_RESULT = z.array(z.object({ locked: z.boolean() })).length(1);

const authenticationUnavailable = (): HttpException =>
  apiError(503, ERROR_CODES.SERVICE_UNAVAILABLE, "认证服务暂不可用，请重试");

const emailTaken = (): HttpException =>
  apiError(409, ERROR_CODES.EMAIL_TAKEN, "邮箱已注册，请登录");

const invalidAccess = (): HttpException =>
  apiError(401, ERROR_CODES.TOKEN_INVALID, "登录会话已失效，请重新登录");

const getJwtSecret = (): string => {
  const secret = loadEnv().JWT_SECRET;
  if (!secret) throw authenticationUnavailable();
  return secret;
};

const userResponse = (user: UserEntity): User => User.parse({
  id: user.uuid,
  username: user.username,
  email: user.email,
  avatarUrl: user.avatarUrl,
  createdAt: user.createdAt.toISOString(),
});

@Injectable()
export class AuthService {
  constructor(
    @Inject(DatabaseService) private readonly database: Pick<DatabaseService, "dataSource">,
    @Inject(RefreshSessions) private readonly sessions: RefreshSessions,
  ) {}

  register = async (input: RegisterInput, idempotencyKey: string, traceId: string) => {
    const secret = getJwtSecret();
    const receipt = await this.findOrCreateRegistration(input, digestCredential(idempotencyKey), traceId);
    if (!receipt) return { status: "busy" as const };

    const { sessionId, refreshToken } = registrationRefreshSession(secret, receipt.uuid);
    const lifetimeMs = await this.sessions.establish({
      userId: receipt.id,
      userUuid: receipt.uuid,
      sessionId,
      refreshToken,
      lifetimeMs: receipt.createdAt.getTime() + REFRESH_LIFETIME_MS - Date.now(),
      allowCreate: !receipt.registrationSessionIssued,
    });
    if (!lifetimeMs) throw emailTaken();

    if (!receipt.registrationSessionIssued) {
      await this.useDatabase(async () => {
        const result = await this.database.dataSource.getRepository(UserEntity).update(
          { id: receipt.id },
          { registrationSessionIssued: true },
        );
        if (result.affected !== 1) throw authenticationUnavailable();
      });
    }

    const issuedAt = Math.floor(receipt.createdAt.getTime() / 1000);
    return {
      status: "ready" as const,
      auth: AuthResult.parse({ ...issueAccessToken(secret, receipt.uuid, sessionId, issuedAt), user: userResponse(receipt) }),
      traceId: receipt.registrationTraceId ?? traceId,
      refreshToken,
      lifetimeMs,
    };
  };

  login = async (input: LoginInput) => {
    const secret = getJwtSecret();
    const user = await this.useDatabase(() =>
      this.database.dataSource.getRepository(UserEntity).findOneBy({ email: input.email }),
    );
    const matches = await verifyPassword(input.password, user?.passwordHash ?? null);
    if (!user || !matches) throw apiError(401, ERROR_CODES.INVALID_CREDENTIALS, "邮箱或密码错误");

    const { sessionId, refreshToken } = newRefreshSession(user.uuid);
    const lifetimeMs = await this.sessions.establish({ userId: user.id, userUuid: user.uuid, sessionId, refreshToken });
    if (!lifetimeMs) throw authenticationUnavailable();

    return {
      auth: AuthResult.parse({ ...issueAccessToken(secret, user.uuid, sessionId), user: userResponse(user) }),
      refreshToken,
      lifetimeMs,
    };
  };

  refresh = async (token: string) => {
    const identity = readRefreshIdentity(token);
    if (!identity) return null;
    const secret = getJwtSecret();
    const result = await this.sessions.rotate(identity, token);
    if (!result) return null;

    return {
      access: issueAccessToken(secret, identity.userUuid, identity.sessionId),
      refreshToken: result.refreshToken,
      lifetimeMs: REFRESH_LIFETIME_MS,
    };
  };

  authenticate = async (authorization: string | undefined) => {
    if (!authorization) throw apiError(401, ERROR_CODES.TOKEN_MISSING, "请先登录");
    const token = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1];
    if (!token) throw invalidAccess();

    const result = verifyAccessToken(getJwtSecret(), token);
    if (result.status === "expired") throw apiError(401, ERROR_CODES.TOKEN_EXPIRED, "访问令牌已过期");
    if (result.status !== "valid") throw invalidAccess();

    const { userUuid, sessionId } = result;
    const userId = await this.sessions.getActiveOwner({ userUuid, sessionId });
    if (!userId) throw invalidAccess();
    return { userId, userUuid, sessionId };
  };

  logout = async (identity: RefreshIdentity, cookie: string, allDevices: boolean): Promise<void> => {
    const cookieIdentity = readRefreshIdentity(cookie);
    if (cookieIdentity && (cookieIdentity.sessionId !== identity.sessionId || cookieIdentity.userUuid !== identity.userUuid)) {
      throw invalidAccess();
    }
    if (!await this.sessions.revoke(identity, allDevices)) throw invalidAccess();
  };

  me = async (userId: string, userUuid: string): Promise<User> => {
    const user = await this.useDatabase(() =>
      this.database.dataSource.getRepository(UserEntity).findOneBy({ id: userId, uuid: userUuid }),
    );
    if (!user) throw apiError(404, ERROR_CODES.USER_NOT_FOUND, "用户不存在");
    return userResponse(user);
  };

  private readonly findOrCreateRegistration = (input: RegisterInput, keyDigest: string, traceId: string) =>
    this.useDatabase(() => this.database.dataSource.transaction(async (manager) => {
      const rows: unknown = await manager.query(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked",
        [`auth:registration:${keyDigest}`],
      );
      if (!REGISTRATION_LOCK_RESULT.parse(rows)[0]?.locked) return null;

      const users = manager.getRepository(UserEntity);
      const receipt = await users.findOneBy({ registrationKeyDigest: keyDigest });
      if (receipt && Date.now() - receipt.createdAt.getTime() < REGISTRATION_REPLAY_MS) {
        const matches = await verifyPassword(input.password, receipt.passwordHash);
        if (!matches || receipt.email !== input.email || receipt.username !== input.username) {
          throw apiError(422, ERROR_CODES.IDEMPOTENCY_KEY_REUSED, "注册请求内容已变化，请重新提交");
        }
        return receipt;
      }

      if (receipt) {
        await users.update({ id: receipt.id }, { registrationKeyDigest: null, registrationTraceId: null });
      }
      const existing = await users.existsBy({ email: input.email });
      if (existing) throw emailTaken();

      const passwordHash = await hashPassword(input.password);
      await users.createQueryBuilder().insert().values({
        email: input.email,
        username: input.username,
        passwordHash,
        registrationKeyDigest: keyDigest,
        registrationTraceId: traceId,
      }).orIgnore().execute();

      const created = await users.findOneBy({ registrationKeyDigest: keyDigest });
      if (!created) throw emailTaken();
      return created;
    }));

  private readonly useDatabase = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw authenticationUnavailable();
    }
  };
}
