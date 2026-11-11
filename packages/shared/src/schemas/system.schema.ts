import { z } from "zod";

/**
 * 系统接口（§9.1）：
 * `GET /health` 只表示进程存活，不检查依赖；响应豁免统一 ApiResponse 外壳。
 * `GET /ready` 复用同一形状，依赖不就绪时由 Controller 返回 503。
 */
export const HealthResult = z.object({
  status: z.literal("ok"),
});
export type HealthResult = z.infer<typeof HealthResult>;
