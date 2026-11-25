import { randomUUID } from "node:crypto";
import {
  GraphInput,
  MockDatabase,
  parseMockSseData,
  type Citation,
  type MockSseFrame,
} from "@arch-flow/shared";
import { describe, expect, it, vi } from "vitest";
import { createFixtureAgent } from "../lib/fixture-agent";
import { createMockRunRuntime } from "../lib/mock-run-runtime";

vi.mock("node:timers/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:timers/promises")>()),
  setTimeout: async () => undefined,
}));

const OWNER = "owner-1";
const PROJECT = "project-1";
const CONVERSATION = "conversation-1";
const timestamp = "2026-11-24T10:00:00.000Z";
const draftGraph = GraphInput.parse({
  nodes: [{ id: "orders", type: "service", label: "当前订单服务" }],
  edges: [],
});

const makeStore = () => {
  let saved = MockDatabase.parse({
    projects: [{
      id: PROJECT,
      name: "本地项目",
      description: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    conversations: [{
      id: CONVERSATION,
      projectId: PROJECT,
      title: "项目问答",
      draftGraph,
      draftVersion: 7,
      messageCount: 0,
      lastMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    }],
  });
  const read = async (userId: string) =>
    userId === OWNER
      ? structuredClone(saved)
      : MockDatabase.parse({ projects: [], conversations: [] });
  return {
    read,
    update: async <Result>(userId: string, mutate: (data: MockDatabase) => Result) => {
      const database = await read(userId);
      const result = mutate(database);
      if (userId === OWNER) saved = database;
      return result;
    },
  };
};

const citation: Citation = {
  fileId: "cache-rules",
  fileName: "缓存规范.md",
  snippet: "商品缓存 TTL 为 371 秒。",
  score: 1,
};

const getFrames = (streamed: string): MockSseFrame[] =>
  streamed.split("\n").flatMap((line) => {
    if (!line.startsWith("data: ")) return [];
    const frame = parseMockSseData(line.slice(6));
    return frame ? [frame] : [];
  });

describe("Mock grounded chat", () => {
  it("streams and persists only the same exact evidence for the authenticated run without changing its draft", async () => {
    const searchKnowledge = vi.fn().mockResolvedValue({ citations: [citation] });
    const fixture = createFixtureAgent(searchKnowledge);
    const store = makeStore();
    const runtime = createMockRunRuntime(store, fixture);
    const run = await runtime.accept(
      OWNER,
      CONVERSATION,
      { content: "说明《缓存规范》中的商品缓存 TTL。" },
      randomUUID(),
    );
    const frames = getFrames(await (await runtime.stream(OWNER, run.runId)).text());

    expect(searchKnowledge).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ projectId: PROJECT, attachments: [] }),
      expect.objectContaining({ names: ["缓存规范"] }),
      expect.any(AbortSignal),
    );
    expect(frames).toContainEqual({ type: "status", stage: "searching_knowledge" });
    expect(frames).toContainEqual({ type: "citation", sources: [citation] });
    expect(frames.some(({ type }) => type === "graph")).toBe(false);
    expect((await store.read(OWNER)).conversations[0]).toMatchObject({
      draftGraph,
      draftVersion: 7,
    });

    const restarted = createMockRunRuntime(store, fixture);
    const snapshot = await restarted.snapshot(OWNER, run.runId);
    expect(snapshot.assistantMessage.content).toContain(citation.snippet);
    expect(snapshot.assistantMessage.content).not.toContain("当前订单服务");
    expect(snapshot.assistantMessage.metadata?.citations).toEqual([citation]);
  });

  it("explains missing knowledge without a generic answer, citation or fallback to the current graph", async () => {
    const searchKnowledge = vi.fn().mockResolvedValue({
      citations: [],
      unavailableReason: "当前项目找不到「旧规范」这份资料。",
    });
    const runtime = createMockRunRuntime(makeStore(), createFixtureAgent(searchKnowledge));
    const run = await runtime.accept(
      OWNER,
      CONVERSATION,
      { content: "根据《旧规范》回答商品缓存 TTL。" },
      randomUUID(),
    );
    const frames = getFrames(await (await runtime.stream(OWNER, run.runId)).text());
    expect(frames.some(({ type }) => type === "citation" || type === "graph")).toBe(false);
    const snapshot = await runtime.snapshot(OWNER, run.runId);
    expect(snapshot.run.status).toBe("succeeded");
    expect(snapshot.assistantMessage.content).toBe("当前项目找不到「旧规范」这份资料。");
    expect(snapshot.assistantMessage.metadata?.citations).toEqual([]);
  });

  it("does not treat a matching document as permission to apply a cache policy", async () => {
    const searchKnowledge = vi.fn().mockResolvedValue({ citations: [citation] });
    const store = makeStore();
    const runtime = createMockRunRuntime(store, createFixtureAgent(searchKnowledge));
    const run = await runtime.accept(
      OWNER,
      CONVERSATION,
      { content: "根据《缓存规范》给订单查询加缓存，再解释改完的流程。" },
      randomUUID(),
    );
    const frames = getFrames(await (await runtime.stream(OWNER, run.runId)).text());
    expect(frames.some(({ type }) => type === "citation" || type === "graph")).toBe(false);
    const snapshot = await runtime.snapshot(OWNER, run.runId);
    expect(snapshot.run).toMatchObject({
      status: "failed",
      error: { message: expect.stringContaining("已找到项目资料") },
    });
    expect(searchKnowledge).toHaveBeenCalledOnce();
    expect((await store.read(OWNER)).conversations[0]).toMatchObject({
      draftGraph,
      draftVersion: 7,
    });
  });

  it.each([
    "给当前订单查询加缓存，注意遵守《缓存规范》",
    "按《缓存规范》的要求给当前订单查询加缓存",
    "按《缓存规范》给当前订单查询加 Redis，再解释改完的流程",
  ])("does not apply local graph edits that are conditioned on named policies (%s)", async (content) => {
    const searchKnowledge = vi.fn().mockResolvedValue({ citations: [] });
    const store = makeStore();
    const runtime = createMockRunRuntime(store, createFixtureAgent(searchKnowledge));
    const run = await runtime.accept(OWNER, CONVERSATION, { content }, randomUUID());

    await (await runtime.stream(OWNER, run.runId)).text();
    const snapshot = await runtime.snapshot(OWNER, run.runId);
    expect(snapshot.run).toMatchObject({
      status: "failed", error: { message: expect.stringContaining("改图和后续解释未完成") },
    });
    expect(searchKnowledge).toHaveBeenCalledOnce();
    expect((await store.read(OWNER)).conversations[0]).toMatchObject({ draftGraph, draftVersion: 7 });
  });

  it("asks for a historical graph reference instead of treating its quoted title as a file", async () => {
    const searchKnowledge = vi.fn().mockResolvedValue({ citations: [] });
    const runtime = createMockRunRuntime(makeStore(), createFixtureAgent(searchKnowledge));
    const run = await runtime.accept(OWNER, CONVERSATION, { content: "解释《上一个版本》" }, randomUUID());

    await (await runtime.stream(OWNER, run.runId)).text();
    expect((await runtime.snapshot(OWNER, run.runId)).run.status).toBe("waiting_input");
    expect(searchKnowledge).not.toHaveBeenCalled();
  });
});
