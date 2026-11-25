import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  hashPassword,
  issueAccessToken,
  verifyAccessToken,
  verifyPassword,
} from "../src/modules/auth/auth-credentials.js";

it("creates a different salted password hash for each account", async () => {
  const password = "验证用密码abc123";
  const [first, second] = await Promise.all([
    hashPassword(password),
    hashPassword(password),
  ]);

  expect(first).not.toBe(second);
  await expect(verifyPassword(password, first)).resolves.toBe(true);
  await expect(verifyPassword("不同的密码abc123", first)).resolves.toBe(false);
  await expect(verifyPassword(password, null)).resolves.toBe(false);
});

it("distinguishes a properly signed expired access token from an invalid token", () => {
  const secret = randomBytes(32).toString("base64url");
  const userUuid = randomUUID();
  const sessionId = randomUUID();
  const issuedAt = 1_800_000_000;
  const { accessToken } = issueAccessToken(secret, userUuid, sessionId, issuedAt);

  expect(verifyAccessToken(secret, accessToken, issuedAt)).toEqual({
    status: "valid", userUuid, sessionId,
  });
  expect(verifyAccessToken(secret, accessToken, issuedAt + 900)).toEqual({ status: "expired" });
  expect(verifyAccessToken(randomBytes(32).toString("base64url"), accessToken, issuedAt)).toEqual({ status: "invalid" });
});
