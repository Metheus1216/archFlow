import { z } from "zod";
import { FinishReason, Id, ISODateTime, RunStatus } from "./common.schema.js";

/** 运行失败明细：code 是 §1.5 的常量表，message 只承载展示文案。 */
export const RunError = z.object({
  code: z.string(),
  message: z.string(),
});
export type RunError = z.infer<typeof RunError>;

/** 一次 agent 运行（§6.3）：状态与结束原因均走枚举，未知值解析即失败。 */
export const Run = z.object({
  id: Id,
  conversationId: Id,
  userMessageId: Id,
  assistantMessageId: Id,
  status: RunStatus,
  finishReason: FinishReason.nullable(),
  createdAt: ISODateTime,
  finishedAt: ISODateTime.nullable(),
  error: RunError.nullable(),
});
export type Run = z.infer<typeof Run>;

/* ───────────────────────── HITL 中断（§5.1） ───────────────────────── */

/** 中断类型：澄清、副作用审批、结果复核。 */
export const InterruptKind = z.enum(["clarification", "approval", "review"]);
export type InterruptKind = z.infer<typeof InterruptKind>;

/**
 * HITL 中断：落 `runs.metadata.interrupt`，重连时从库里重放。
 * `payload` 的具体字段由对应节点在 P0-07 定义，这里先约束为 JSON 对象。
 */
export const Interrupt = z.object({
  interruptId: Id,
  kind: InterruptKind,
  node: z.string().min(1).max(50),
  payload: z.record(z.string(), z.unknown()),
  expiresAt: ISODateTime,
});
export type Interrupt = z.infer<typeof Interrupt>;

/* ───────────────────────── 运行阶段与受理响应（§5.1 / §5.2） ───────────────────────── */

/** 生成阶段（§5.2 的 status 帧）。 */
export const RunStage = z.enum([
  "thinking",
  "searching_knowledge",
  "drafting_graph",
  "finalizing",
]);
export type RunStage = z.infer<typeof RunStage>;

/**
 * SSE 地址的唯一生成入口（§5.1）：服务端按 runId 拼出，前端必须原样使用。
 * 不允许前端自行拼接——反代 / 网关可能改写前缀。
 */
export const runStreamUrl = (runId: string): string =>
  `/api/v1/runs/${runId}/stream`;

/** 服务端生成的流地址；解析响应时只校验形态，不信任客户端传入。 */
const StreamUrl = z
  .string()
  .regex(
    /^\/api\/v1\/runs\/[A-Za-z0-9_-]+\/stream$/,
    "streamUrl 由服务端按 runId 生成",
  )
  .describe("SSE 地址（服务端生成）");

/** 受理响应（§5.1 的 202）。 */
export const RunAccepted = z.object({
  runId: Id,
  userMessageId: Id,
  assistantMessageId: Id,
  streamUrl: StreamUrl,
  status: RunStatus,
});
export type RunAccepted = z.infer<typeof RunAccepted>;

/** 取消响应（§5.4）：取消是异步的，返回当前状态。 */
export const CancelResult = z.object({
  runId: Id,
  status: RunStatus,
});
export type CancelResult = z.infer<typeof CancelResult>;
