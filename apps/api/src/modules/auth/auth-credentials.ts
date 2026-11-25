import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import type { AccessTokenResult } from "@arch-flow/shared";
import { z } from "zod";

const PASSWORD_ALGORITHM = "scrypt-v1";
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_DIGEST_BYTES = 32;
const SCRYPT_OPTIONS = { N: 32_768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const DUMMY_SALT = Buffer.alloc(PASSWORD_SALT_BYTES);
const DUMMY_DIGEST = Buffer.alloc(PASSWORD_DIGEST_BYTES);

const derivePassword = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_DIGEST_BYTES, SCRYPT_OPTIONS, (error, hash) => {
      if (error) reject(error);
      else resolve(hash);
    });
  });

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const hash = await derivePassword(password, salt);
  return `${PASSWORD_ALGORITHM}:${salt.toString("base64url")}:${hash.toString("base64url")}`;
};

const readBytes = (encoded: string | undefined, length: number): Buffer | null => {
  if (!encoded) return null;
  const decoded = Buffer.from(encoded, "base64url");
  return decoded.length === length && decoded.toString("base64url") === encoded
    ? decoded
    : null;
};

export const verifyPassword = async (password: string, stored: string | null): Promise<boolean> => {
  const [algorithm, encodedSalt, encodedHash, extra] = stored?.split(":") ?? [];
  const salt = readBytes(encodedSalt, PASSWORD_SALT_BYTES);
  const digest = readBytes(encodedHash, PASSWORD_DIGEST_BYTES);
  const candidate = await derivePassword(password, salt ?? DUMMY_SALT);
  const matches = timingSafeEqual(candidate, digest ?? DUMMY_DIGEST);
  return algorithm === PASSWORD_ALGORITHM && Boolean(salt && digest) && extra === undefined && matches;
};

const ACCESS_SECONDS = 15 * 60;
const CLOCK_SKEW_SECONDS = 30;
const MAX_ACCESS_TOKEN_LENGTH = 2_048;
const JWT_HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

const ACCESS_CLAIMS = z.strictObject({
  iss: z.literal("archflow-api"),
  aud: z.literal("archflow-web"),
  sub: z.uuid(),
  sid: z.uuid(),
  iat: z.int().nonnegative(),
  exp: z.int().positive(),
});

export const currentEpochSeconds = (): number => Math.floor(Date.now() / 1000);

const signJwt = (secret: string, encodedClaims: string): Buffer =>
  createHmac("sha256", secret).update(`${JWT_HEADER}.${encodedClaims}`).digest();

export const issueAccessToken = (
  secret: string,
  userUuid: string,
  sessionId: string,
  issuedAt = currentEpochSeconds(),
): AccessTokenResult => {
  const claims: z.infer<typeof ACCESS_CLAIMS> = {
    iss: "archflow-api",
    aud: "archflow-web",
    sub: userUuid,
    sid: sessionId,
    iat: issuedAt,
    exp: issuedAt + ACCESS_SECONDS,
  };
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = signJwt(secret, encodedClaims).toString("base64url");
  return {
    accessToken: `${JWT_HEADER}.${encodedClaims}.${signature}`,
    tokenType: "Bearer",
    expiresIn: ACCESS_SECONDS,
  };
};

type AccessVerification =
  | { status: "valid"; userUuid: string; sessionId: string }
  | { status: "expired" | "invalid" };

export const verifyAccessToken = (
  secret: string,
  token: string,
  now = currentEpochSeconds(),
): AccessVerification => {
  if (token.length > MAX_ACCESS_TOKEN_LENGTH) return { status: "invalid" };
  const [header, encodedClaims, encodedSignature, extra] = token.split(".");
  if (header !== JWT_HEADER || !encodedClaims || extra !== undefined) return { status: "invalid" };

  const signature = readBytes(encodedSignature, 32);
  if (!signature || !timingSafeEqual(signature, signJwt(secret, encodedClaims))) return { status: "invalid" };

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8"));
  } catch {
    return { status: "invalid" };
  }

  const result = ACCESS_CLAIMS.safeParse(claims);
  if (!result.success) return { status: "invalid" };
  const { sub, sid, iat, exp } = result.data;
  if (exp !== iat + ACCESS_SECONDS || iat > now + CLOCK_SKEW_SECONDS) return { status: "invalid" };
  if (exp <= now) return { status: "expired" };
  return { status: "valid", userUuid: sub, sessionId: sid };
};

const REFRESH_PREFIX = "rt_";
const REFRESH_NONCE_BYTES = 32;
const TOKEN_DIGEST_BYTES = 32;
const REFRESH_IDENTITY = z.object({ userUuid: z.uuid(), sessionId: z.uuid() });

export type RefreshIdentity = z.infer<typeof REFRESH_IDENTITY>;

export const digestCredential = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const createRefreshToken = (
  userUuid: string,
  sessionId: string,
  nonce = randomBytes(REFRESH_NONCE_BYTES),
): string => `${REFRESH_PREFIX}${userUuid}.${sessionId}.${nonce.toString("base64url")}`;

export const newRefreshSession = (userUuid: string) => {
  const sessionId = randomUUID();
  return { sessionId, refreshToken: createRefreshToken(userUuid, sessionId) };
};

export const rotateRefreshToken = ({ userUuid, sessionId }: RefreshIdentity): string =>
  createRefreshToken(userUuid, sessionId);

export const readRefreshIdentity = (token: string): RefreshIdentity | null => {
  if (!token.startsWith(REFRESH_PREFIX)) return null;
  const [userUuid, sessionId, nonce, extra] = token.slice(REFRESH_PREFIX.length).split(".");
  if (extra !== undefined || !readBytes(nonce, REFRESH_NONCE_BYTES)) return null;
  const identity = REFRESH_IDENTITY.safeParse({ userUuid, sessionId });
  return identity.success ? identity.data : null;
};

export const registrationRefreshSession = (secret: string, userUuid: string) => {
  const identity = createHmac("sha256", secret)
    .update("archflow-registration-session\0")
    .update(userUuid)
    .digest();
  identity.writeUInt8((identity.readUInt8(6) & 0x0f) | 0x80, 6);
  identity.writeUInt8((identity.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = identity.subarray(0, 16).toString("hex");
  const sessionId = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
  const nonce = createHmac("sha256", secret)
    .update("archflow-registration-refresh\0")
    .update(userUuid)
    .update(sessionId)
    .digest()
    .subarray(0, TOKEN_DIGEST_BYTES);

  return { sessionId, refreshToken: createRefreshToken(userUuid, sessionId, nonce) };
};
