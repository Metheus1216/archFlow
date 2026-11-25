import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  ApiResponseSchema,
  AuthResult,
  ERROR_CODES,
  ForkResult,
  type AgentTurnResult,
  type Graph,
  type Message,
  type MockDatabase,
} from "@arch-flow/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as register } from "../app/api/mock/auth/[action]/route";
import { POST as fork } from "../app/api/mock/conversations/[conversationId]/fork/route";
import {
  appendMessage,
  createAsset,
  createConversation,
  createProject,
  deleteConversation,
  getMockConversationRecord,
  listMessages,
  readMockDatabase,
  saveConversationDraft,
  updateMockDatabase,
  updateMockConversationRecord,
} from "../lib/mock-db";
import { createMockRunRuntime } from "../lib/mock-run-runtime";

const ORIGIN = "http://localhost:3000";
const DIRECTORY_PREFIX = "archflow-mock-fork-";
const CREATED_AT = "2026-11-24T10:00:00.000Z";
const FIRST_GRAPH: Graph = {
  nodes: [{ id: "orders", type: "service", label: "订单服务" }],
  edges: [],
};
const NEXT_GRAPH: Graph = {
  nodes: [{ id: "orders", type: "service", label: "新版订单服务" }],
  edges: [],
};
const ANSWER_ONLY: AgentTurnResult = {
  status: "succeeded",
  text: "这是说明。",
  constraints: {},
  citations: [],
  graph: null,
};
const FILE_STORE = { read: readMockDatabase, update: updateMockDatabase };

const interceptRunWrite = () => {
  let nextAction: (() => Promise<unknown>) | undefined;
  return {
    ...FILE_STORE,
    afterNextWrite: (action: () => Promise<unknown>) => { nextAction = action; },
    update: async <Result>(userId: string, apply: (database: MockDatabase) => Result) => {
      const result = await updateMockDatabase(userId, apply);
      const action = nextAction;
      nextAction = undefined;
      await action?.();
      return result;
    },
  };
};

const registerAccount = async (email: string) => {
  const response = await register(
    new Request(`${ORIGIN}/api/mock/auth/register`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ username: "AC6 test", email, password: "test-password" }),
    }),
    { params: Promise.resolve({ action: "register" }) },
  );
  expect(response.status).toBe(201);
  const { data } = ApiResponseSchema(AuthResult).parse(await response.json());
  if (!data) throw new Error("注册未返回数据");
  return { userId: data.user.id, authorization: `Bearer ${data.accessToken}` };
};

const setupConversation = async () => {
  const owner = await registerAccount("owner@example.com");
  const project = await createProject(owner.userId, { name: "历史分叉测试" }, randomUUID());
  if (!project?.lastActiveConversationId) throw new Error("创建项目未返回会话");
  const conversationId = project.lastActiveConversationId;

  const post = (body: unknown, options: {
    key?: string | null;
    authorization?: string;
    targetId?: string;
    rawBody?: string;
  } = {}) => {
    const { key = randomUUID(), authorization = owner.authorization, targetId = conversationId } = options;
    const headers = new Headers({ Authorization: authorization, "Content-Type": "application/json" });
    if (key !== null) headers.set("Idempotency-Key", key);
    return fork(
      new Request(`${ORIGIN}/api/mock/conversations/${targetId}/fork`, {
        method: "POST",
        headers,
        body: options.rawBody ?? JSON.stringify(body),
      }),
      { params: Promise.resolve({ conversationId: targetId }) },
    );
  };

  return { ...owner, project, conversationId, post };
};

const readFork = async (response: Response) => {
  expect(response.status).toBe(201);
  const { traceId, data } = ApiResponseSchema(ForkResult).parse(await response.json());
  if (!data) throw new Error("创建分支未返回数据");
  return { traceId, result: data };
};

const message = (id: string, role: Message["role"], content: string): Message => ({
  id,
  role,
  content,
  createdAt: CREATED_AT,
  graphSnapshot: null,
  metadata: null,
});

describe("local conversation fork endpoint", () => {
  beforeEach(async ({ onTestFinished }) => {
    const temporaryRoot = await realpath(tmpdir());
    const directory = await mkdtemp(join(temporaryRoot, DIRECTORY_PREFIX));
    vi.stubEnv("ARCHFLOW_MOCK_DIR", directory);
    onTestFinished(async () => {
      vi.unstubAllEnvs();
      const target = await realpath(directory);
      if (dirname(target) === temporaryRoot && basename(target).startsWith(DIRECTORY_PREFIX)) {
        await rm(target, { recursive: true, force: true, maxRetries: 3 });
      }
    });
  });

  it("copies the ordered prefix and the nearest historical graph into an independent conversation", async () => {
    const { userId, project, conversationId, post } = await setupConversation();
    const question = message("z-prompt", "user", "请帮我设计订单服务");
    const answer = message("z-answer", "user", "部署在单机");
    const graph: Message = {
      ...message("a-graph", "assistant", "这是确认后的架构"),
      graphSnapshot: FIRST_GRAPH,
      metadata: {
        suggestedQuestions: ["如何部署？"],
        card: {
          id: randomUUID(), messageId: "a-graph", kind: "text", title: "部署环境是什么？",
          options: [], status: "answered", answer: { values: [answer.content], isCustom: true },
          createdAt: CREATED_AT, answeredAt: CREATED_AT,
        },
      },
    };
    const followUp = message("y-followup", "user", "需要做高可用吗？");
    const interruptId = randomUUID();
    const pending = {
      ...message("b-card", "assistant", "部署环境是什么？"),
      metadata: {
        card: {
          id: interruptId, messageId: "b-card", kind: "text", title: "允许单机吗？",
          options: [], status: "pending", answer: null, createdAt: CREATED_AT, answeredAt: null,
        },
      },
    } satisfies Message;
    const later: Message = {
      ...message("a-later", "assistant", "这是后来才生成的架构"),
      graphSnapshot: NEXT_GRAPH,
    };
    const history = [question, answer, graph, followUp, pending, later];
    await updateMockConversationRecord(userId, conversationId, (record) => ({
      ...record,
      messages: history,
      messageCount: history.length,
      draftGraph: NEXT_GRAPH,
      draftLayout: [{ nodeId: "orders", x: 480, y: 240 }],
      draftVersion: 4,
      agentConstraints: { deployment: "高可用跨区部署" },
      runs: [{
        id: randomUUID(), conversationId, userMessageId: followUp.id,
        assistantMessageId: pending.id, status: "waiting_input", finishReason: null,
        createdAt: CREATED_AT, finishedAt: null, error: null, traceId: randomUUID(),
        cursor: 0, stage: null, workerId: null, attachments: [], receipts: [],
        answeredInterrupts: [],
        interrupt: {
          interruptId, kind: "clarification", node: "resolve_intent", payload: {},
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      }],
    }));

    const { result } = await readFork(await post({ sourceMessageId: pending.id }));
    expect(result).toMatchObject({
      projectId: project.id,
      title: expect.stringMatching(/（分叉）$/),
      messageCount: 5,
      draftGraph: FIRST_GRAPH,
      draftVersion: 0,
      forkedFrom: { conversationId, sourceMessageId: pending.id },
    });
    expect(result.id).not.toBe(conversationId);
    expect(result).not.toHaveProperty("draftLayout");
    const branch = await getMockConversationRecord(userId, result.id);
    expect(branch?.runs).toBeUndefined();
    expect(branch?.pendingAgentTurn).toBeUndefined();
    expect(branch?.agentConstraints).toBeUndefined();
    const copied = await listMessages(userId, result.id, { limit: 20, direction: "forward" });
    const copiedMessages = copied?.items ?? [];
    expect(copiedMessages.map(({ role, content, createdAt, graphSnapshot }) => ({ role, content, createdAt, graphSnapshot })))
      .toEqual(history.slice(0, 5).map(({ role, content, createdAt, graphSnapshot }) => ({ role, content, createdAt, graphSnapshot })));
    expect(new Set(copiedMessages.map(({ id }) => id)).size).toBe(5);
    expect(copiedMessages.every(({ id }) => !history.some((original) => original.id === id))).toBe(true);
    expect(result.lastMessage).toEqual({
      id: copiedMessages[4].id, role: pending.role, contentPreview: pending.content, createdAt: CREATED_AT,
    });
    expect(copiedMessages[2].metadata).toMatchObject({
      suggestedQuestions: graph.metadata?.suggestedQuestions,
      card: { messageId: copiedMessages[2].id, status: "answered", answer: graph.metadata?.card?.answer },
    });
    expect(copiedMessages[2].metadata?.card?.id).not.toBe(graph.metadata?.card?.id);
    expect(copiedMessages[4].metadata?.card).toMatchObject({
      messageId: copiedMessages[4].id, status: "expired", answer: null, answeredAt: null,
    });
    expect(copiedMessages[4].metadata?.card?.id).not.toBe(interruptId);

    await saveConversationDraft(userId, result.id, { graph: NEXT_GRAPH, baseVersion: 0 });
    await appendMessage(userId, result.id, { content: "分支才有的消息" });
    const original = await getMockConversationRecord(userId, conversationId);
    expect(original).toMatchObject({ messages: history, draftVersion: 4 });
    expect(await getMockConversationRecord(userId, result.id)).toMatchObject({
      draftVersion: 1, draftGraph: NEXT_GRAPH, messageCount: 6,
    });
  });

  it("starts with an empty canvas when the selected history precedes every graph", async () => {
    const { userId, conversationId, post } = await setupConversation();
    const first = await appendMessage(userId, conversationId, { content: "我只有一个想法" });
    if (!first) throw new Error("首条消息未保存");
    await saveConversationDraft(userId, conversationId, { graph: NEXT_GRAPH, baseVersion: 0 });

    const { result } = await readFork(await post({ sourceMessageId: first.id }));
    expect(result).toMatchObject({ draftGraph: null, draftVersion: 0, messageCount: 1 });
    expect(result).not.toHaveProperty("draftLayout");
  });

  it("uses the restored draft for a read-only turn even after the source canvas changes again", async () => {
    const { userId, conversationId, post } = await setupConversation();
    const initial = { ...message("initial", "assistant", "原始架构"), graphSnapshot: FIRST_GRAPH };
    const revised = { ...message("revised", "assistant", "新版架构"), graphSnapshot: NEXT_GRAPH };
    await updateMockConversationRecord(userId, conversationId, (record) => ({
      ...record,
      draftGraph: NEXT_GRAPH,
      draftVersion: 2,
      messages: [initial, revised],
      messageCount: 2,
    }));
    await saveConversationDraft(userId, conversationId, { graph: FIRST_GRAPH, baseVersion: 2 });
    const runtime = createMockRunRuntime(FILE_STORE, { execute: async () => ANSWER_ONLY });
    const run = await runtime.accept(userId, conversationId, {
      content: "解释这张历史图",
      graphReferenceMessageId: revised.id,
    }, randomUUID());
    await (await runtime.stream(userId, run.runId)).text();
    const snapshot = await runtime.snapshot(userId, run.runId);
    expect(snapshot).toMatchObject({ run: { status: "succeeded" }, assistantMessage: { graphSnapshot: null } });
    await saveConversationDraft(userId, conversationId, { graph: NEXT_GRAPH, baseVersion: 3 });

    const { result } = await readFork(await post({ sourceMessageId: run.assistantMessageId }));
    expect(result.draftGraph).toEqual(FIRST_GRAPH);
    const copied = await listMessages(userId, result.id, { limit: 10, direction: "forward" });
    const sent = copied?.items.find(({ role }) => role === "user");
    if (!sent) throw new Error("分支缺少用户消息");
    expect(sent.graphSnapshot).toBeNull();
    expect(sent).not.toHaveProperty("draftGraphAtSend");

    const nested = await readFork(await post({ sourceMessageId: sent.id }, { targetId: result.id }));
    expect(nested.result.draftGraph).toEqual(FIRST_GRAPH);
  });

  it("forks from the draft the worker used if another tab saved after the message was accepted", async () => {
    const { userId, conversationId, post } = await setupConversation();
    await saveConversationDraft(userId, conversationId, { graph: FIRST_GRAPH, baseVersion: 0 });
    const store = interceptRunWrite();
    const runtime = createMockRunRuntime(store, {
      execute: async ({ draftGraph }) => {
        await saveConversationDraft(userId, conversationId, { graph: FIRST_GRAPH, baseVersion: 2 });
        return { ...ANSWER_ONLY, text: `解释${draftGraph?.nodes[0]?.label}` };
      },
    });
    store.afterNextWrite(() => saveConversationDraft(userId, conversationId, { graph: NEXT_GRAPH, baseVersion: 1 }));
    const run = await runtime.accept(userId, conversationId, { content: "解释当前架构" }, randomUUID());
    await (await runtime.stream(userId, run.runId)).text();
    const snapshot = await runtime.snapshot(userId, run.runId);
    expect(snapshot).toMatchObject({
      run: { status: "succeeded" },
      assistantMessage: { content: "解释新版订单服务", graphSnapshot: null },
    });
    expect(snapshot.assistantMessage).not.toHaveProperty("draftGraphAtSend");

    const question = await readFork(await post({ sourceMessageId: run.userMessageId }));
    expect(question.result.draftGraph).toEqual(FIRST_GRAPH);
    const answer = await readFork(await post({ sourceMessageId: run.assistantMessageId }));
    expect(answer.result.draftGraph).toEqual(NEXT_GRAPH);
  });

  it("inherits the asset-initialized draft at the first message", async () => {
    const { userId, project, post } = await setupConversation();
    const saved = await createAsset(userId, project.id, { name: "保存时的架构", graph: FIRST_GRAPH }, randomUUID());
    if (saved.status !== "created") throw new Error("测试资产未创建");
    const initialized = await createConversation(userId, project.id, { initialAssetId: saved.asset.id });
    if (initialized.status !== "created") throw new Error("资产会话未创建");
    const targetId = initialized.conversation.id;
    const sent = await appendMessage(userId, targetId, { content: "从这张图开始" });
    if (!sent) throw new Error("测试消息未保存");
    expect(sent.graphSnapshot).toBeNull();
    expect(sent).not.toHaveProperty("draftGraphAtSend");
    await saveConversationDraft(userId, targetId, { graph: NEXT_GRAPH, baseVersion: 0 });

    const { result } = await readFork(await post({ sourceMessageId: sent.id }, { targetId }));
    expect(result.draftGraph).toEqual(FIRST_GRAPH);
  });

  it("starts with an empty canvas when a later message was sent after the canvas was cleared", async () => {
    const { userId, conversationId, post } = await setupConversation();
    await updateMockConversationRecord(userId, conversationId, (record) => ({
      ...record,
      messages: [{ ...message("earlier", "assistant", "先前的架构"), graphSnapshot: FIRST_GRAPH }],
      messageCount: 1,
      draftGraph: null,
      draftVersion: 2,
    }));
    const sent = await appendMessage(userId, conversationId, { content: "重新开始" });
    if (!sent) throw new Error("测试消息未保存");

    const { result } = await readFork(await post({ sourceMessageId: sent.id }));
    expect(result.draftGraph).toBeNull();
  });

  it.each([
    { step: "after keeping the paused draft", restoreBeforeAnswer: false, answerDraft: NEXT_GRAPH },
    { step: "after restoring the original draft", restoreBeforeAnswer: true, answerDraft: FIRST_GRAPH },
  ])("forks clarification history in its new message order $step", async ({ restoreBeforeAnswer, answerDraft }) => {
    const { userId, conversationId, post } = await setupConversation();
    const initial = { ...message("initial", "assistant", "先前的架构"), graphSnapshot: FIRST_GRAPH };
    await updateMockConversationRecord(userId, conversationId, (record) => ({
      ...record,
      messages: [initial],
      messageCount: 1,
      draftGraph: FIRST_GRAPH,
      draftVersion: 1,
    }));
    const prompt = "解释当前架构";
    const question = "先解释哪部分？";
    const store = interceptRunWrite();
    const runtime = createMockRunRuntime(store, {
      execute: async (_turn, { resume }) => resume ? ANSWER_ONLY : {
        status: "waiting_input",
        text: question,
        constraints: {},
        checkpoint: {
          decision: {
            intents: ["explain_graph"], rewrittenInput: prompt, complexity: "simple", question, constraintUpdates: {},
          },
          attempts: 1,
          question,
        },
      },
    });
    store.afterNextWrite(() => saveConversationDraft(userId, conversationId, { graph: NEXT_GRAPH, baseVersion: 1 }));
    const run = await runtime.accept(userId, conversationId, { content: prompt }, randomUUID());
    await (await runtime.stream(userId, run.runId)).text();
    const paused = await runtime.snapshot(userId, run.runId);
    const interruptId = paused.assistantMessage.metadata?.card?.id;
    if (!interruptId) throw new Error("澄清卡片未生成");

    const pausedFork = await readFork(await post({ sourceMessageId: run.assistantMessageId }));
    expect(pausedFork.result.draftGraph).toEqual(NEXT_GRAPH);
    const restore = () => saveConversationDraft(userId, conversationId, { graph: FIRST_GRAPH, baseVersion: 2 });
    if (restoreBeforeAnswer) await restore();

    let queuedDraft: ForkResult["draftGraph"] | undefined;
    store.afterNextWrite(async () => {
      const queuedFork = await readFork(await post({ sourceMessageId: run.assistantMessageId }));
      queuedDraft = queuedFork.result.draftGraph;
      if (!restoreBeforeAnswer) await restore();
    });
    const answerText = "订单写入流程";
    await runtime.accept(userId, conversationId, { content: answerText, interruptId }, randomUUID());
    expect(queuedDraft).toEqual(answerDraft);
    await (await runtime.stream(userId, run.runId)).text();

    const before = await readFork(await post({ sourceMessageId: run.userMessageId }));
    expect(before.result.draftGraph).toEqual(FIRST_GRAPH);
    const messages = await listMessages(userId, conversationId, { limit: 10, direction: "forward" });
    const reply = messages?.items.find(({ role, content }) => role === "user" && content === answerText);
    if (!reply) throw new Error("缺少澄清回复");
    const fromReply = await readFork(await post({ sourceMessageId: reply.id }));
    expect(fromReply.result.draftGraph).toEqual(answerDraft);
    const after = await readFork(await post({ sourceMessageId: run.assistantMessageId }));
    expect(after.result.draftGraph).toEqual(FIRST_GRAPH);
  });

  it("validates requests and isolates source messages and conversations", async () => {
    const { userId, project, post } = await setupConversation();
    const other = await createConversation(userId, project.id, {});
    if (other.status !== "created") throw new Error("测试会话未创建");
    const targetId = other.conversation.id;
    const member = await appendMessage(userId, targetId, { content: "另一会话独有的消息" });
    if (!member) throw new Error("测试消息未保存");
    const outsider = await registerAccount("outsider@example.com");
    const input = { sourceMessageId: member.id };
    const responses = await Promise.all([
      post(input),
      post(input, { targetId, authorization: outsider.authorization }),
      post(input, { key: null }),
      post(input, { key: "bad-key" }),
      post({ sourceMessageId: "bad id" }),
      post(input, { targetId: "bad id" }),
      post(input, { rawBody: "{" }),
    ]);
    const expected = [
      [404, ERROR_CODES.MESSAGE_NOT_FOUND],
      [404, ERROR_CODES.CONVERSATION_NOT_FOUND],
      [422, ERROR_CODES.VALIDATION_FAILED],
      [422, ERROR_CODES.VALIDATION_FAILED],
      [400, ERROR_CODES.VALIDATION_FAILED],
      [400, ERROR_CODES.VALIDATION_FAILED],
      [400, ERROR_CODES.BAD_REQUEST],
    ];
    await Promise.all(responses.map(async (response, index) => {
      expect(response.status).toBe(expected[index][0]);
      expect(await response.json()).toMatchObject({ code: expected[index][1], data: null });
    }));
    expect((await readMockDatabase(userId)).conversations).toHaveLength(2);
  });

  it("replays the same response atomically and leaves the branch available after the source is deleted", async () => {
    const { userId, conversationId, post } = await setupConversation();
    const first = await appendMessage(userId, conversationId, { content: "第一个版本" });
    const later = await appendMessage(userId, conversationId, { content: "第二个版本" });
    if (!first || !later) throw new Error("测试消息未保存");
    const body = { sourceMessageId: first.id };
    const key = randomUUID();
    const responses = await Promise.all([post(body, { key }), post(body, { key })]);
    const [created, replay] = await Promise.all(responses.map(readFork));
    expect(replay).toEqual(created);

    await saveConversationDraft(userId, created.result.id, { graph: NEXT_GRAPH, baseVersion: 0 });
    expect(await readFork(await post(body, { key }))).toEqual(created);
    const mismatch = await post({ sourceMessageId: later.id }, { key });
    expect(mismatch.status).toBe(422);
    expect(await mismatch.json()).toMatchObject({ code: ERROR_CODES.IDEMPOTENCY_KEY_REUSED });
    expect((await readMockDatabase(userId)).conversations).toHaveLength(2);

    expect(await deleteConversation(userId, conversationId)).toBe(true);
    expect(await getMockConversationRecord(userId, created.result.id)).toMatchObject({
      draftGraph: NEXT_GRAPH, draftVersion: 1, messageCount: 1,
    });
    expect((await post(body, { key })).status).toBe(404);
  });

  it("allows a 200-message prefix of a longer conversation and rejects a longer copy", async () => {
    const { userId, conversationId, post } = await setupConversation();
    const messages = Array.from({ length: 201 }, (_, index) =>
      message(`source-${index + 1}`, "user", `内容 ${index + 1}`),
    );
    await updateMockConversationRecord(userId, conversationId, (record) => ({
      ...record, messages, messageCount: messages.length,
    }));

    const rejected = await post({ sourceMessageId: "source-201" });
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED, data: null });
    expect((await readMockDatabase(userId)).conversations).toHaveLength(1);
    const { result } = await readFork(await post({ sourceMessageId: "source-200" }));
    expect(result.messageCount).toBe(200);
    expect(result.lastMessage?.contentPreview).toBe("内容 200");
  });
});
