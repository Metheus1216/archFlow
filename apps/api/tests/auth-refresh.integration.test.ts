import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newRefreshSession } from "../src/modules/auth/auth-credentials.js";
import { RefreshSessions } from "../src/modules/auth/refresh-sessions.js";

const redisUrl = process.env.ARCHFLOW_TEST_REDIS_URL;

describe.runIf(Boolean(redisUrl))("authentication sessions with Redis", () => {
  const userUuid = randomUUID();
  const userId = "123";
  let client: Redis;
  let sessions: RefreshSessions;

  beforeAll(async () => {
    client = new Redis(redisUrl ?? "", { lazyConnect: true, maxRetriesPerRequest: 1 });
    await client.connect();
    sessions = new RefreshSessions({ client });
  });

  afterAll(async () => {
    if (!client || client.status !== "ready") return;
    const keys = await client.keys(`archflow:auth:{${userUuid}}:*`);
    if (keys.length) await client.del(...keys);
    await client.quit();
  });

  const createSession = async () => {
    const { sessionId, refreshToken } = newRefreshSession(userUuid);
    const identity = { userUuid, sessionId };
    const lifetime = await sessions.establish({ ...identity, userId, refreshToken });
    expect(lifetime).toBeGreaterThan(0);
    return { identity, refreshToken };
  };

  it("rotates one refresh token atomically and revokes only its family on known reuse", async () => {
    const first = await createSession();
    const second = await createSession();

    const unrelatedToken = newRefreshSession(userUuid).refreshToken;
    await expect(sessions.rotate(first.identity, unrelatedToken)).resolves.toBeNull();
    await expect(sessions.getActiveOwner(first.identity)).resolves.toBe(userId);

    const results = await Promise.all([
      sessions.rotate(first.identity, first.refreshToken),
      sessions.rotate(first.identity, first.refreshToken),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(sessions.getActiveOwner(first.identity)).resolves.toBeNull();
    await expect(sessions.getActiveOwner(second.identity)).resolves.toBe(userId);
  });

  it("expires a registration receipt's authorization after logout and revokes all previous devices", async () => {
    const first = await createSession();
    const second = await createSession();
    await expect(sessions.revoke(first.identity, false)).resolves.toBe(true);
    await expect(sessions.establish({ ...first.identity, userId, refreshToken: first.refreshToken })).resolves.toBeNull();

    await expect(sessions.revoke(second.identity, true)).resolves.toBe(true);
    await expect(sessions.getActiveOwner(second.identity)).resolves.toBeNull();
    const third = await createSession();
    await expect(sessions.getActiveOwner(third.identity)).resolves.toBe(userId);
  });
});
