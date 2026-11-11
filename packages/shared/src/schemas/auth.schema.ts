import { z } from "zod";
import { Count, Id, ISODateTime } from "./common.schema.js";

/**
 * 邮箱（§10.1）：先 trim + 转小写，再校验格式。
 * 存储、唯一性判断、登录比对一律使用归一化后的值。
 */
export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email())
  .describe("邮箱（trim + 小写归一化后校验）");
export type Email = z.infer<typeof Email>;

/** 当前登录用户（§2.1）。 */
export const User = z.object({
  id: Id,
  username: z.string(),
  email: Email,
  avatarUrl: z.url().nullable(),
  createdAt: ISODateTime,
});
export type User = z.infer<typeof User>;

/* ───────────────────────── 请求 DTO（§2） ───────────────────────── */

/** 注册（§2.1）：昵称 1–15、密码 6–16。 */
export const RegisterInput = z.object({
  username: z.string().trim().min(1).max(15),
  email: Email,
  password: z.string().min(6).max(16),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

/** 登录（§2.2）：不做密码强度校验，只防超长；邮箱归一化后比对。 */
export const LoginInput = z.object({
  email: Email,
  password: z.string().min(1).max(72),
});
export type LoginInput = z.infer<typeof LoginInput>;

/* 刷新（§2.3）：refreshToken 由 httpOnly Cookie 携带，无请求体，故不定义 RefreshInput。 */

/** 登出（§2.4）：refreshToken 由 Cookie 携带；body 只保留非 token 选项。 */
export const LogoutInput = z.object({
  allDevices: z.boolean().default(false),
});
export type LogoutInput = z.infer<typeof LogoutInput>;

/** 访问令牌结果（登录 / 刷新）：refreshToken 只写 httpOnly Cookie，不下发 body。 */
export const AccessTokenResult = z.object({
  accessToken: z.string(),
  tokenType: z.literal("Bearer"),
  expiresIn: Count,
});
export type AccessTokenResult = z.infer<typeof AccessTokenResult>;

/** 注册 / 登录响应（§2.1 / §2.2）。 */
export const AuthResult = AccessTokenResult.extend({
  user: User,
});
export type AuthResult = z.infer<typeof AuthResult>;

/* ───────────────────────── 密码重置（§2.6 / §2.7，暂不实现） ───────────────────────── */

export const ForgotPasswordInput = z.object({
  email: Email,
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInput>;

export const ResetPasswordInput = z.object({
  token: z.string().min(1),
  password: z.string().min(6).max(16),
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;
