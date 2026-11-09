/**
 * TODO: 基于 Zod Schema 的 ValidationPipe（替代 class-validator）。
 *
 * 计划：
 *   - 读取 DTO 上的 Zod schema 元数据
 *   - 校验失败时输出 { code: "VALIDATION_FAILED", errors: FieldError[] }
 *   - 图数据失败时调用 mapGraphError() 映射 413 / 422
 */
export {};
