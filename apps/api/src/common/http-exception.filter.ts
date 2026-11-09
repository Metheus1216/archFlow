/**
 * TODO: 全局异常过滤器。
 *
 * 统一响应外壳：
 *   { code, message, data, errors?, traceId }
 *
 * 需处理：
 *   - Nest HttpException → 大写错误码
 *   - ZodError → 422 VALIDATION_FAILED / 413 GRAPH_TOO_LARGE
 *   - 未知异常 → 500 INTERNAL_ERROR（不泄漏堆栈）
 *   - 无 body 的 204 回写 X-Trace-Id
 */
export {};
