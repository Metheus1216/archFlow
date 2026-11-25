import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ERROR_CODES } from "@arch-flow/shared";
import { apiError } from "../../common/api-response.js";
import { RedisService } from "../../infra/redis.service.js";
import {
  digestCredential,
  rotateRefreshToken,
  type RefreshIdentity,
} from "./auth-credentials.js";

export const REFRESH_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

const READ_SESSION = `
local generation = redis.call('GET', KEYS[1]) or 'initial'
local session = redis.call('HMGET', KEYS[2], 'generation', 'owner', 'digest', 'revoked')
local active = session[1] == generation and not session[4]
`;

const EXTEND_GENERATION = `
local generationTtl = redis.call('PTTL', KEYS[1])
if generationTtl >= 0 and generationTtl < lifetime then
  redis.call('PEXPIRE', KEYS[1], lifetime)
end
`;

const ESTABLISH_SESSION = `${READ_SESSION}
if session[1] then
  if active and session[2] == ARGV[1] and session[3] == ARGV[2] then
    return redis.call('PTTL', KEYS[2])
  end
  return 0
end
if ARGV[4] ~= '1' then return 0 end
local lifetime = tonumber(ARGV[3])
redis.call('HSET', KEYS[2], 'generation', generation, 'owner', ARGV[1], 'digest', ARGV[2])
redis.call('PEXPIRE', KEYS[2], lifetime)
${EXTEND_GENERATION}
return lifetime
`;

const ROTATE_SESSION = `${READ_SESSION}
if not active then return false end
if session[3] ~= ARGV[1] then
  if redis.call('EXISTS', KEYS[3]) == 1 then
    redis.call('HSET', KEYS[2], 'revoked', '1')
  end
  return false
end
local remaining = redis.call('PTTL', KEYS[2])
if remaining <= 0 then return false end
redis.call('SET', KEYS[3], '1', 'PX', remaining)
local lifetime = tonumber(ARGV[3])
redis.call('HSET', KEYS[2], 'digest', ARGV[2])
redis.call('PEXPIRE', KEYS[2], lifetime)
${EXTEND_GENERATION}
return session[2]
`;

const GET_ACTIVE_OWNER = `${READ_SESSION}
if active then return session[2] end
return false
`;

const REVOKE_SESSION = `${READ_SESSION}
if not active then return 0 end
if ARGV[1] == '1' then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
else
  redis.call('HSET', KEYS[2], 'revoked', '1')
end
return 1
`;

const redisKeys = ({ userUuid, sessionId }: RefreshIdentity) => {
  const scope = `archflow:auth:{${userUuid}}`;
  const session = `${scope}:session:${sessionId}`;
  return { generation: `${scope}:generation`, session };
};

type EstablishSessionInput = RefreshIdentity & {
  userId: string;
  refreshToken: string;
  lifetimeMs?: number;
  allowCreate?: boolean;
};

@Injectable()
export class RefreshSessions {
  constructor(@Inject(RedisService) private readonly redis: Pick<RedisService, "client">) {}

  establish = async ({
    userUuid,
    sessionId,
    userId,
    refreshToken,
    lifetimeMs = REFRESH_LIFETIME_MS,
    allowCreate = true,
  }: EstablishSessionInput): Promise<number | null> => {
    if (lifetimeMs <= 0) return null;
    const keys = redisKeys({ userUuid, sessionId });
    const remaining = await this.evaluate(
      ESTABLISH_SESSION,
      [keys.generation, keys.session],
      [userId, digestCredential(refreshToken), lifetimeMs, allowCreate ? "1" : "0"],
    );
    return typeof remaining === "number" && remaining > 0 ? remaining : null;
  };

  rotate = async (identity: RefreshIdentity, currentToken: string) => {
    const keys = redisKeys(identity);
    const currentDigest = digestCredential(currentToken);
    const refreshToken = rotateRefreshToken(identity);
    const userId = await this.evaluate(
      ROTATE_SESSION,
      [keys.generation, keys.session, `${keys.session}:used:${currentDigest}`],
      [currentDigest, digestCredential(refreshToken), REFRESH_LIFETIME_MS],
    );
    return typeof userId === "string" ? { userId, refreshToken } : null;
  };

  getActiveOwner = async (identity: RefreshIdentity): Promise<string | null> => {
    const keys = redisKeys(identity);
    const userId = await this.evaluate(GET_ACTIVE_OWNER, [keys.generation, keys.session], []);
    return typeof userId === "string" ? userId : null;
  };

  revoke = async (identity: RefreshIdentity, allDevices: boolean): Promise<boolean> => {
    const keys = redisKeys(identity);
    const result = await this.evaluate(
      REVOKE_SESSION,
      [keys.generation, keys.session],
      [allDevices ? "1" : "0", randomUUID(), REFRESH_LIFETIME_MS],
    );
    return result === 1;
  };

  private readonly evaluate = async (
    script: string,
    keys: string[],
    args: Array<string | number>,
  ): Promise<unknown> => {
    try {
      return await this.redis.client.eval(script, keys.length, ...keys, ...args);
    } catch {
      throw apiError(503, ERROR_CODES.SERVICE_UNAVAILABLE, "认证服务暂不可用，请重试");
    }
  };
}
