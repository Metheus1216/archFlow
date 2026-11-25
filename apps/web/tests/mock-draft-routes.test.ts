import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApiResponseSchema,
  AuthResult,
  Conversation,
  ERROR_CODES,
  GRAPH_MAX_EDGES,
  GRAPH_MAX_NODES,
  SaveDraftResult,
  parseMockSseData,
  type Graph,
} from "@arch-flow/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as register } from "../app/api/mock/auth/[action]/route";
import { GET as getConversation } from "../app/api/mock/conversations/[conversationId]/route";
import { PUT as saveDraft } from "../app/api/mock/conversations/[conversationId]/draft/route";
import {
  createProject,
  readMockDatabase,
  updateMockDatabase,
} from "../lib/mock-db";
import { createMockRunRuntime } from "../lib/mock-run-runtime";

const ORIGIN = "http://localhost:3000";
const GRAPH: Graph = {
  nodes: [
    { id: "service", type: "service", label: "订单服务" },
    { id: "old-cache", type: "cache", label: "旧缓存" },
  ],
  edges: [{ id: "lookup", source: "service", target: "old-cache" }],
};

const registerAccount = async (email: string) => {
  const response = await register(
    new Request(`${ORIGIN}/api/mock/auth/register`, {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        username: "AC4 test",
        email,
        password: "test-password",
      }),
    }),
    { params: Promise.resolve({ action: "register" }) },
  );
  expect(response.status).toBe(201);
  const { data } = ApiResponseSchema(AuthResult).parse(await response.json());
  if (!data) throw new Error("注册未返回数据");
  return {
    userId: data.user.id,
    headers: { Authorization: `Bearer ${data.accessToken}` },
  };
};

const setupConversation = async () => {
  const owner = await registerAccount("owner@example.com");
  const project = await createProject(
    owner.userId,
    { name: "画布测试" },
    randomUUID(),
  );
  const conversationId = project?.lastActiveConversationId;
  if (!conversationId) throw new Error("创建项目没有返回会话");
  const path = `${ORIGIN}/api/mock/conversations/${conversationId}`;
  const context = { params: Promise.resolve({ conversationId }) };

  return {
    ...owner,
    conversationId,
    put: (body: unknown, headers: Record<string, string> = owner.headers) =>
      saveDraft(
        new Request(`${path}/draft`, {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        context,
      ),
    read: async () => {
      const response = await getConversation(
        new Request(path, { headers: owner.headers }),
        context,
      );
      expect(response.status).toBe(200);
      const { data } = ApiResponseSchema(Conversation).parse(
        await response.json(),
      );
      return data;
    },
  };
};

describe("local draft endpoint", () => {
  beforeEach(async ({ onTestFinished }) => {
    const directory = await mkdtemp(join(tmpdir(), "archflow-mock-draft-"));
    vi.stubEnv("ARCHFLOW_MOCK_DIR", directory);
    onTestFinished(async () => {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    });
  });

  it("persists one layout when two writes use the same version", async () => {
    const { put, read } = await setupConversation();
    const layouts = [
      [{ nodeId: "service", x: 81.5, y: -120 }],
      [{ nodeId: "service", x: 243, y: 64 }],
    ];
    const responses = await Promise.all(
      layouts.map((layout) => put({ graph: GRAPH, layout, baseVersion: 0 })),
    );
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    const winner = responses.findIndex(({ status }) => status === 200);
    const { data } = ApiResponseSchema(SaveDraftResult).parse(
      await responses[winner].json(),
    );
    expect(data?.draftVersion).toBe(1);
    expect(await responses[1 - winner].json()).toMatchObject({
      code: ERROR_CODES.DRAFT_VERSION_CONFLICT,
      data: null,
    });
    expect(await read()).toMatchObject({
      draftGraph: GRAPH,
      draftLayout: layouts[winner],
      draftVersion: 1,
      updatedAt: data?.updatedAt,
    });

    expect((await put({ graph: GRAPH, baseVersion: 1 })).status).toBe(200);
    expect(await read()).not.toHaveProperty("draftLayout");
  });

  it("scopes authorized writes to the conversation owner", async () => {
    const { put, read } = await setupConversation();
    const outsider = await registerAccount("other@example.com");
    const input = { graph: GRAPH, baseVersion: 0 };

    expect((await put(input, {})).status).toBe(401);
    const response = await put(input, outsider.headers);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: ERROR_CODES.CONVERSATION_NOT_FOUND,
      data: null,
    });
    expect(await read()).toMatchObject({ draftGraph: null, draftVersion: 0 });
  });

  it("rejects bad versions, invalid graph layouts, and oversized graphs", async () => {
    const { put, read } = await setupConversation();
    const nodes = Array.from({ length: GRAPH_MAX_NODES }, (_, index) => ({
      id: `node-${index}-${"x".repeat(54)}`,
      type: "service",
      label: "点".repeat(120),
      description: "点".repeat(500),
    }));
    const edges = Array.from({ length: GRAPH_MAX_EDGES }, (_, index) => ({
      id: `edge-${index}-${"x".repeat(54)}`,
      source: nodes[0].id,
      target: nodes[1].id,
      label: "边".repeat(120),
    }));
    const invalidRequests = [
      {
        input: { graph: GRAPH, baseVersion: -1 },
        status: 422,
        code: ERROR_CODES.VALIDATION_FAILED,
      },
      {
        input: { graph: { nodes: [] }, baseVersion: 0 },
        status: 422,
        code: ERROR_CODES.GRAPH_INVALID,
      },
      {
        input: {
          graph: GRAPH,
          layout: [{ nodeId: "missing-node", x: 0, y: 0 }],
          baseVersion: 0,
        },
        status: 422,
        code: ERROR_CODES.GRAPH_INVALID,
      },
      {
        input: { graph: { nodes, edges }, baseVersion: 0 },
        status: 413,
        code: ERROR_CODES.GRAPH_TOO_LARGE,
      },
    ];
    for (const { input, status, code } of invalidRequests) {
      const response = await put(input);
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code, data: null });
    }
    expect(await read()).toMatchObject({ draftGraph: null, draftVersion: 0 });
  });

  it("protects a layout saved while the assistant is editing and lets the next run use it", async () => {
    const { userId, conversationId, put, read } = await setupConversation();
    const changedGraph: Graph = {
      nodes: [
        { id: "service", type: "service", label: "订单查询" },
        { id: "new-cache", type: "cache", label: "查询缓存" },
      ],
      edges: [{ id: "lookup", source: "service", target: "new-cache" }],
    };
    const manualLayout = [
      { nodeId: "service", x: 150, y: 120 },
      { nodeId: "old-cache", x: 60, y: 20 },
    ];
    expect((await put({ graph: GRAPH, baseVersion: 0 })).status).toBe(200);

    let release = () => {};
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const versions: number[] = [];
    const runtime = createMockRunRuntime(
      { read: readMockDatabase, update: updateMockDatabase },
      {
        execute: async (turn) => {
          versions.push(turn.draftVersion);
          await pause;
          return {
            status: "succeeded",
            text: "已修改。",
            constraints: {},
            citations: [],
            graph: changedGraph,
          };
        },
      },
    );
    const input = { content: "把订单服务改成订单查询，并换成查询缓存" };
    const stale = await runtime.accept(
      userId,
      conversationId,
      input,
      randomUUID(),
    );
    const stream = await runtime.stream(userId, stale.runId);
    const staleText = stream.text();
    try {
      await vi.waitFor(() => expect(versions).toEqual([1]));
      expect(
        (await put({ graph: GRAPH, layout: manualLayout, baseVersion: 1 }))
          .status,
      ).toBe(200);
    } finally {
      release();
      await staleText;
    }
    const frames = (await staleText)
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => parseMockSseData(line.slice(6)));
    expect(frames).toContainEqual(
      expect.objectContaining({
        type: "error",
        code: ERROR_CODES.DRAFT_VERSION_CONFLICT,
      }),
    );
    expect(frames.some((frame) => frame?.type === "graph")).toBe(false);
    expect(await runtime.snapshot(userId, stale.runId)).toMatchObject({
      run: { status: "failed" },
      assistantMessage: { graphSnapshot: null },
    });
    expect(await read()).toMatchObject({
      draftGraph: GRAPH,
      draftVersion: 2,
      draftLayout: manualLayout,
    });

    const retry = await runtime.accept(
      userId,
      conversationId,
      input,
      randomUUID(),
    );
    await (await runtime.stream(userId, retry.runId)).text();
    expect(versions).toEqual([1, 2]);
    expect(await runtime.snapshot(userId, retry.runId)).toMatchObject({
      run: { status: "succeeded" },
      assistantMessage: { graphSnapshot: changedGraph },
    });
    expect(await read()).toMatchObject({
      draftGraph: changedGraph,
      draftVersion: 3,
      draftLayout: [{ nodeId: "service", x: 150, y: 120 }],
    });
  });
});
