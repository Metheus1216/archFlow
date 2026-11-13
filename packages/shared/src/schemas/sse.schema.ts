import { z } from "zod";
import {
  CardStatus,
  Count,
  FinishReason,
  Graph,
  Id,
  TraceId,
} from "./common.schema.js";
import { Interrupt, RunStage } from "./agent.schema.js";
import {
  CardAnswer,
  Citation,
  ConstraintCard,
} from "./conversation.schema.js";

/** 流内事件（§5.2）：按 type 判别，未知 type 直接解析失败。 */
export const SseFrame = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run-start"),
    runId: Id,
    conversationId: Id,
    userMessageId: Id,
    assistantMessageId: Id,
    traceId: TraceId,
    /** HITL 恢复时重新建立流；前端保留已有气泡，不清空本地文本。 */
    resume: z.boolean().optional(),
  }),
  z.object({ type: z.literal("status"), stage: RunStage }),
  z.object({
    type: z.literal("text-delta"),
    messageId: Id,
    content: z.string(),
    replace: z.literal(true).optional(),
  }),
  z.object({ type: z.literal("citation"), sources: z.array(Citation) }),
  z.object({ type: z.literal("graph"), graph: Graph, replace: z.literal(true) }),
  z.object({
    type: z.literal("constraint-card"),
    messageId: Id,
    card: ConstraintCard,
  }),
  Interrupt.extend({ type: z.literal("interrupt") }),
  z.object({
    type: z.literal("card-updated"),
    cardId: Id,
    status: CardStatus,
    answer: CardAnswer.nullable(),
  }),
  z.object({
    type: z.literal("usage"),
    inputTokens: Count,
    outputTokens: Count,
    model: z.string(),
    latencyMs: Count,
  }),
  z.object({
    type: z.literal("title"),
    conversationId: Id,
    title: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
  z.object({
    type: z.literal("done"),
    assistantMessageId: Id,
    finishReason: FinishReason,
  }),
]);
export type SseFrame = z.infer<typeof SseFrame>;

/** 终止哨兵：收到 [DONE] 即停止解析，并重新拉一次消息列表拿权威数据。 */
export const SSE_DONE = "[DONE]";

/** 解析 `data:` 后的 JSON 内容；返回 null 表示收到 [DONE]。 */
export const parseSseData = (raw: string): SseFrame | null => {
  if (raw === SSE_DONE) {
    return null;
  }

  let json: unknown;

  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`SSE data 不是合法 JSON: ${raw.slice(0, 100)}`);
  }

  return SseFrame.parse(json);
};
