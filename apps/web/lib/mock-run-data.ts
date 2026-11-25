import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  ERROR_CODES,
  Message,
  Run,
  mockRunStreamUrl,
  type AgentTurn,
  type MockConversationRecord,
  type MockDatabase,
  type MockRunAccepted,
  type MockRunSnapshot,
  type MockStoredMessage,
  type MockStoredRun,
} from "@arch-flow/shared";
import { readMockGraph } from "./read-mock-graph";

export class MockRunError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const getRunConversation = (database: MockDatabase, id: string) => {
  const conversation = database.conversations.find(
    (record) => record.id === id,
  );
  if (!conversation)
    throw new MockRunError(
      404,
      ERROR_CODES.CONVERSATION_NOT_FOUND,
      "会话不存在",
    );
  return conversation;
};

export const getStoredRun = (database: MockDatabase, id: string) => {
  for (const conversation of database.conversations) {
    const run = conversation.runs?.find((record) => record.id === id);
    if (run) return { conversation, run };
  }
  throw new MockRunError(404, ERROR_CODES.RUN_NOT_FOUND, "运行不存在");
};

export const getRunMessage = (
  conversation: MockConversationRecord,
  id: string,
) => {
  const message = conversation.messages.find((record) => record.id === id);
  if (!message)
    throw new MockRunError(
      409,
      ERROR_CODES.RUN_NOT_RESUMABLE,
      "运行缺少关联消息",
    );
  return message;
};

export const makeRunMessage = (
  role: Message["role"],
  content: string,
): Message => ({
  id: randomUUID(),
  role,
  content,
  graphSnapshot: null,
  metadata: null,
  createdAt: new Date().toISOString(),
});

export const getHistoricalDraft = (messages: MockStoredMessage[]) => {
  const latest = messages.findLast(
    ({ graphSnapshot, draftGraphAtSend }) => graphSnapshot !== null || draftGraphAtSend !== undefined,
  );
  return latest?.graphSnapshot ?? latest?.draftGraphAtSend ?? null;
};

export const getDraftChange = (
  { draftGraph, messages }: MockConversationRecord,
  precedingMessages = messages,
) => isDeepStrictEqual(draftGraph, getHistoricalDraft(precedingMessages))
  ? undefined
  : draftGraph;

export const makeUserMessage = (
  conversation: MockConversationRecord,
  content: string,
): MockStoredMessage => ({
  ...makeRunMessage("user", content),
  draftGraphAtSend: getDraftChange(conversation),
});

export const updateConversationMessages = (
  conversation: MockConversationRecord,
  last: Message,
) => {
  conversation.messageCount = conversation.messages.length;
  conversation.lastMessage = {
    id: last.id,
    role: last.role,
    contentPreview: last.content.slice(0, 80),
    createdAt: last.createdAt,
  };
  conversation.updatedAt = new Date().toISOString();
};

export const activeStatus = (status: Run["status"]) =>
  status === "queued" || status === "running" || status === "waiting_input";

export const acceptedRun = (run: MockStoredRun): MockRunAccepted => ({
  runId: run.id,
  userMessageId: run.userMessageId,
  assistantMessageId: run.assistantMessageId,
  streamUrl: mockRunStreamUrl(run.id),
  status: run.status,
});

export const snapshotRun = (
  conversation: MockConversationRecord,
  run: MockStoredRun,
): MockRunSnapshot => ({
  run: Run.parse(run),
  assistantMessage: Message.parse(getRunMessage(conversation, run.assistantMessageId)),
  stage: run.stage,
});

export const getReferencedGraph = (
  conversation: MockConversationRecord,
  messageId: string,
): NonNullable<AgentTurn["referencedGraph"]> => {
  const message = conversation.messages.find(
    ({ id, role }) => id === messageId && role === "assistant",
  );
  const graph = readMockGraph(message?.graphSnapshot ?? null);
  if (!graph) {
    throw new MockRunError(
      404,
      ERROR_CODES.MESSAGE_NOT_FOUND,
      "找不到可引用的历史图，请从当前会话重新选择。",
    );
  }
  return { messageId, graph };
};
