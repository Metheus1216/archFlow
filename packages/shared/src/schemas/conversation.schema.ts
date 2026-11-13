import { z } from "zod";
import {
  CardKind,
  CardStatus,
  Count,
  GraphInput,
  Id,
  ISODateTime,
  LooseGraph,
  MessageRole,
  PaginationQuery,
} from "./common.schema.js";

/* ───────────────────────── 会话 ───────────────────────── */

export const ConversationMeta = z.object({
  id: Id,
  projectId: Id,
  title: z.string(),
  updatedAt: ISODateTime,
});
export type ConversationMeta = z.infer<typeof ConversationMeta>;

export const LastMessage = z.object({
  id: Id,
  role: MessageRole,
  contentPreview: z.string(),
  createdAt: ISODateTime,
});
export type LastMessage = z.infer<typeof LastMessage>;

export const Conversation = ConversationMeta.extend({
  draftGraph: LooseGraph.nullable(),
  draftVersion: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  lastMessage: LastMessage.nullable(),
  createdAt: ISODateTime,
});
export type Conversation = z.infer<typeof Conversation>;

/* ───────────────────────── 约束卡片 ───────────────────────── */

export const CardOption = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
});
export type CardOption = z.infer<typeof CardOption>;

export const CardAnswer = z.object({
  values: z.array(z.string()).min(1),
  isCustom: z.boolean(),
});
export type CardAnswer = z.infer<typeof CardAnswer>;

export const ConstraintCard = z.object({
  id: Id,
  messageId: Id,
  kind: CardKind,
  title: z.string(),
  options: z.array(CardOption),
  status: CardStatus,
  answer: CardAnswer.nullable(),
  createdAt: ISODateTime,
  answeredAt: ISODateTime.nullable(),
});
export type ConstraintCard = z.infer<typeof ConstraintCard>;

/* ───────────────────────── 消息 ───────────────────────── */

export const Citation = z.object({
  fileId: Id,
  fileName: z.string(),
  snippet: z.string(),
  score: z.number().min(0).max(1),
});
export type Citation = z.infer<typeof Citation>;

export const Usage = z.object({
  inputTokens: Count,
  outputTokens: Count,
  model: z.string(),
  latencyMs: Count,
});
export type Usage = z.infer<typeof Usage>;

export const MessageMetadata = z.object({
  card: ConstraintCard.optional(),
  citations: z.array(Citation).optional(),
  usage: Usage.optional(),
});
export type MessageMetadata = z.infer<typeof MessageMetadata>;

export const Message = z.object({
  id: Id,
  role: MessageRole,
  content: z.string(),
  graphSnapshot: LooseGraph.nullable(),
  metadata: MessageMetadata.nullable(),
  createdAt: ISODateTime,
});
export type Message = z.infer<typeof Message>;

/* ───────────────────────── 请求 DTO（§4 / §6） ───────────────────────── */

export const CreateConversationInput = z.object({
  title: z.string().trim().min(1).max(50).optional(),
  initialAssetId: Id.optional(),
});
export type CreateConversationInput = z.infer<typeof CreateConversationInput>;

export const UpdateConversationInput = z.object({
  title: z.string().trim().min(1).max(50),
});
export type UpdateConversationInput = z.infer<typeof UpdateConversationInput>;

export const SaveDraftInput = z.object({
  graph: GraphInput,
  baseVersion: z.number().int().nonnegative(),
});
export type SaveDraftInput = z.infer<typeof SaveDraftInput>;

export const SaveDraftResult = z.object({
  draftVersion: z.number().int().nonnegative(),
  updatedAt: ISODateTime,
});
export type SaveDraftResult = z.infer<typeof SaveDraftResult>;

export const MessageListQuery = PaginationQuery.extend({
  direction: z.enum(["backward", "forward"]).default("backward"),
});
export type MessageListQuery = z.infer<typeof MessageListQuery>;

export const SendMessageInput = z.object({
  content: z.string().trim().min(1).max(20000),
  attachments: z.array(Id).max(5).optional(),
});
export type SendMessageInput = z.infer<typeof SendMessageInput>;

export const AnswerCardInput = z.object({
  cardId: Id.optional(),
  values: z.array(z.string().trim().min(1)).min(1),
  isCustom: z.boolean().default(false),
});
export type AnswerCardInput = z.infer<typeof AnswerCardInput>;

export const ForkInput = z.object({
  sourceMessageId: Id,
});
export type ForkInput = z.infer<typeof ForkInput>;

export const ForkResult = Conversation.extend({
  forkedFrom: z.object({
    conversationId: Id,
    sourceMessageId: Id,
  }),
});
export type ForkResult = z.infer<typeof ForkResult>;
