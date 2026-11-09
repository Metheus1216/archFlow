/**
 * @arch-flow/shared
 *
 * 前后端共享契约的唯一出口。骨架阶段先放一个 dummy 导出，
 * 用来验证 workspace 引用链路（apps/web、apps/api、packages/agent）。
 *
 * 后续按 specs/API文档/10. 数据模型（Zod）拆分为：
 *   src/schemas/common.schema.ts
 *   src/schemas/auth.schema.ts
 *   src/schemas/project.schema.ts
 *   src/schemas/conversation.schema.ts
 *   src/schemas/agent.schema.ts
 *   src/schemas/sse.schema.ts
 */
export const dummy = "arch-flow" as const;
