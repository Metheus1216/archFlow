import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
  ConversationEntity,
  MessageEntity,
  UserEntity,
  createDataSource,
} from "@arch-flow/db";
import type { Graph } from "@arch-flow/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkspaceCanvasService } from "../src/modules/workspace/workspace-canvas.service.js";
import { WorkspaceService } from "../src/modules/workspace/workspace.service.js";

const testUrl = process.env.ARCHFLOW_TEST_DATABASE_URL;
const dataSource = createDataSource(testUrl ?? "postgres://localhost/archflow_unused");
const workspace = new WorkspaceService({ dataSource });
const canvas = new WorkspaceCanvasService({ dataSource });

it("treats an opaque project ID that is not stored as a UUID as missing", async () => {
  await expect(workspace.getProject("1", "prj_missing")).rejects.toMatchObject({
    status: 404,
    response: { code: "PROJECT_NOT_FOUND" },
  });
});

describe.runIf(Boolean(testUrl))("Workspace with PostgreSQL", () => {
  beforeAll(async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();
  }, 20_000);

  afterAll(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  const createOwner = () =>
    dataSource.getRepository(UserEntity).save({
      username: "workspace-user",
      email: `${randomUUID()}@archflow.test`,
      passwordHash: "fixture",
    });

  const createOptions = () => ({ key: randomUUID(), traceId: randomUUID() });

  it("replays a committed project response and scopes creation keys by operation", async () => {
    const owner = await createOwner();
    const options = createOptions();
    const project = await workspace.createProject(owner.id, { name: "订单" }, options);
    await workspace.updateProject(owner.id, project.data.id, { name: "订单新版" });
    await expect(
      workspace.createProject(owner.id, { name: "订单" }, { ...options, traceId: randomUUID() }),
    ).resolves.toEqual(project);
    await expect(
      workspace.createProject(owner.id, { name: "不同订单" }, options),
    ).rejects.toMatchObject({ response: { code: "IDEMPOTENCY_KEY_REUSED" }, status: 422 });

    const conversation = await workspace.createConversation(owner.id, project.data.id, {}, options);
    await expect(
      workspace.createConversation(owner.id, project.data.id, {}, { ...options, traceId: randomUUID() }),
    ).resolves.toEqual(conversation);

    const tree = await workspace.listProjects(owner.id, { limit: 20 });
    expect(tree.items).toEqual([
      expect.objectContaining({
        id: project.data.id,
        name: "订单新版",
        lastActiveConversationId: conversation.data.id,
        conversations: [expect.objectContaining({ id: conversation.data.id })],
      }),
    ]);
  });

  it("hides another account's project, conversations and messages", async () => {
    const owner = await createOwner();
    const visitor = await createOwner();
    const { data: project } = await workspace.createProject(owner.id, { name: "私有项目" }, createOptions());
    const { data: conversation } = await workspace.createConversation(owner.id, project.id, {}, createOptions());

    await expect(workspace.listProjects(visitor.id, { limit: 20 })).resolves.toMatchObject({ items: [] });
    await expect(workspace.getProject(visitor.id, project.id)).rejects.toMatchObject({ status: 404 });
    await expect(workspace.listConversations(visitor.id, project.id, { limit: 20 })).rejects.toMatchObject({ status: 404 });
    await expect(workspace.listMessages(visitor.id, conversation.id, { limit: 20, direction: "backward" })).rejects.toMatchObject({ status: 404 });
  });

  it("pages tied message timestamps in order and excludes system messages", async () => {
    const owner = await createOwner();
    const { data: project } = await workspace.createProject(owner.id, { name: "消息分页" }, createOptions());
    const { data: conversation } = await workspace.createConversation(owner.id, project.id, {}, createOptions());
    const row = await dataSource.getRepository(ConversationEntity).findOneByOrFail({ uuid: conversation.id });
    const createdAt = new Date("2026-11-25T00:00:00Z");
    await dataSource.getRepository(MessageEntity).save([
      { conversationId: row.id, role: "user", content: "第一条", createdAt },
      { conversationId: row.id, role: "system", content: "内部消息", createdAt },
      { conversationId: row.id, role: "assistant", content: "部分回答", createdAt },
      { conversationId: row.id, role: "user", content: "第三条", createdAt },
    ]);

    const latest = await workspace.listMessages(owner.id, conversation.id, { limit: 2, direction: "backward" });
    expect(latest.items.map(({ content }) => content)).toEqual(["部分回答", "第三条"]);
    expect(latest.hasMore).toBe(true);
    const earlier = await workspace.listMessages(owner.id, conversation.id, {
      limit: 2, direction: "backward", cursor: latest.nextCursor ?? undefined,
    });
    expect(earlier.items.map(({ content }) => content)).toEqual(["第一条"]);
    expect(earlier.hasMore).toBe(false);
    await expect(workspace.getConversation(owner.id, conversation.id)).resolves.toMatchObject({
      messageCount: 3,
      lastMessage: { contentPreview: "第三条" },
    });
  });

  const graph: Graph = { nodes: [{ id: "web", label: "应用", type: "client" }], edges: [] };
  const layout = [{ nodeId: "web", x: 80, y: 120 }];

  it("saves one layout when two clients edit the same draft version", async () => {
    const owner = await createOwner();
    const { data: project } = await workspace.createProject(owner.id, { name: "画布" }, createOptions());
    const { data: conversation } = await workspace.createConversation(owner.id, project.id, {}, createOptions());
    const alternativeLayout = [{ nodeId: "web", x: 300, y: 400 }];
    const results = await Promise.allSettled([layout, alternativeLayout].map((positions) =>
      canvas.saveDraft(owner.id, conversation.id, { graph, layout: positions, baseVersion: 0 }),
    ));

    const winner = results.findIndex(({ status }) => status === "fulfilled");
    expect(winner).toBeGreaterThanOrEqual(0);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({ reason: { status: 409, response: { code: "DRAFT_VERSION_CONFLICT" } } });
    await expect(workspace.getConversation(owner.id, conversation.id)).resolves.toMatchObject({
      draftGraph: graph, draftLayout: [layout, alternativeLayout][winner], draftVersion: 1,
    });
    await canvas.saveDraft(owner.id, conversation.id, { graph, baseVersion: 1 });
    expect((await workspace.getConversation(owner.id, conversation.id)).draftLayout).toBeUndefined();
  });

  it("keeps a saved asset snapshot after the editable draft changes", async () => {
    const owner = await createOwner();
    const { data: project } = await workspace.createProject(owner.id, { name: "资产" }, createOptions());
    const { data: conversation } = await workspace.createConversation(owner.id, project.id, {}, createOptions());
    const options = createOptions();
    const snapshot = { name: "固定画布", graph, layout };
    const saved = await canvas.saveAsset(owner.id, project.id, snapshot, options);
    await expect(canvas.saveAsset(owner.id, project.id, snapshot, { ...options, traceId: randomUUID() })).resolves.toEqual(saved);
    await canvas.saveDraft(owner.id, conversation.id, { graph: { nodes: [], edges: [] }, baseVersion: 0 });

    await expect(canvas.getAsset(owner.id, project.id, saved.data.id, true)).resolves.toMatchObject(snapshot);
    await expect(workspace.listProjects(owner.id, { limit: 20 })).resolves.toMatchObject({
      items: [{ assets: [{ id: saved.data.id, name: "固定画布" }] }],
    });
    await expect(workspace.createConversation(owner.id, project.id, { initialAssetId: saved.data.id }, createOptions())).resolves.toMatchObject({
      data: { draftGraph: graph, draftLayout: layout },
    });
  });

  it("forks the selected history with an independent draft and new card IDs", async () => {
    const owner = await createOwner();
    const { data: project } = await workspace.createProject(owner.id, { name: "历史" }, createOptions());
    const { data: source } = await workspace.createConversation(owner.id, project.id, {}, createOptions());
    const row = await dataSource.getRepository(ConversationEntity).findOneByOrFail({ uuid: source.id });
    const cardMessageId = randomUUID();
    const cardId = randomUUID();
    const lastSourceId = randomUUID();
    const createdAt = new Date("2026-11-25T00:00:00Z");
    const emptyGraph = { nodes: [], edges: [] };
    await dataSource.getRepository(MessageEntity).save([
      { conversationId: row.id, role: "assistant", content: "旧图", graphSnapshot: graph, createdAt },
      { conversationId: row.id, uuid: cardMessageId, role: "assistant", content: "请选择", createdAt, metadata: { card: {
        id: cardId, messageId: cardMessageId, kind: "text", title: "请选择", options: [], status: "pending",
        answer: null, createdAt: createdAt.toISOString(), answeredAt: null,
      } } },
      { conversationId: row.id, uuid: lastSourceId, role: "user", content: "此时画布已清空", createdAt, draftGraphContext: { graph: emptyGraph } },
      { conversationId: row.id, role: "assistant", content: "稍后的图", graphSnapshot: graph, createdAt },
    ]);
    await canvas.saveDraft(owner.id, source.id, { graph, layout, baseVersion: 0 });
    const options = createOptions();
    const forked = await canvas.forkConversation(owner.id, source.id, { sourceMessageId: lastSourceId }, options);
    expect(forked.data).toMatchObject({
      draftGraph: emptyGraph, draftVersion: 0, messageCount: 3,
      forkedFrom: { conversationId: source.id, sourceMessageId: lastSourceId },
    });
    await expect(canvas.forkConversation(owner.id, source.id, { sourceMessageId: lastSourceId }, { ...options, traceId: randomUUID() })).resolves.toEqual(forked);
    const copied = await workspace.listMessages(owner.id, forked.data.id, { limit: 20, direction: "backward" });
    expect(copied.items.map(({ content }) => content)).toEqual(["旧图", "请选择", "此时画布已清空"]);
    const copiedCard = copied.items[1]?.metadata?.card;
    expect(copiedCard).toMatchObject({ status: "expired", messageId: copied.items[1]?.id });
    expect(copiedCard?.id).not.toBe(cardId);
    await canvas.saveDraft(owner.id, forked.data.id, { graph: emptyGraph, baseVersion: 0 });
    await expect(workspace.getConversation(owner.id, source.id)).resolves.toMatchObject({
      draftGraph: graph, draftLayout: layout, draftVersion: 1,
    });
  });
});
