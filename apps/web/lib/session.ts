/**
 * 前端路由守卫使用的“会话提示”Cookie。
 *
 * 这里不存放任何 token：
 * - accessToken 按规范只保存在内存；
 * - refreshToken 是 API 下发的 httpOnly Cookie（Path=/api/v1/auth），前端读不到；
 * - 本 Cookie 只表示浏览器侧存在过登录态，仅供 middleware 做跳转，不承担鉴权。
 * 真正的鉴权仍由 API 的 401 兜底。
 */
export const SESSION_HINT_COOKIE = "archflow_session";

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export const setSessionHint = () => {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = `${SESSION_HINT_COOKIE}=1; Path=/; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
};

export const clearSessionHint = () => {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = `${SESSION_HINT_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`;
};
