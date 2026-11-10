/**
 * @arch-flow/shared
 *
 * 前后端共享契约的唯一出口。所有数据结构以 Zod Schema 为唯一真理，
 * TypeScript 类型一律由 z.infer 派生。
 *
 * 已覆盖：common（基础类型 / 图 / 响应外壳）、project、conversation。
 * 待补齐：auth、agent、sse。
 */
export * from "./constants/error-codes.js";
export * from "./schemas/common.schema.js";
export * from "./schemas/project.schema.js";
export * from "./schemas/conversation.schema.js";
export * from "./schemas/mock.schema.js";
