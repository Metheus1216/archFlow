import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  ApiResponseSchema,
  Asset,
  AssetMeta,
  AuthResult,
  ERROR_CODES,
  type AssetInput,
  type DraftLayout,
} from "@arch-flow/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as register } from "../app/api/mock/auth/[action]/route";
import { POST as saveAsset } from "../app/api/mock/projects/[projectId]/assets/route";
import { GET as getAsset } from "../app/api/mock/projects/[projectId]/assets/[assetId]/route";
import {
  createConversation,
  createProject,
  listProjectNodes,
  saveConversationDraft,
} from "../lib/mock-db";

const ORIGIN = "http://localhost:3000";
const MOCK_DIRECTORY_PREFIX = "archflow-mock-assets-";
const SNAPSHOT: AssetInput & { layout: DraftLayout } = {
  name: "保存时的架构",
  graph: {
    nodes: [
      { id: "service", type: "service", label: "订单服务" },
      { id: "store", type: "database", label: "订单数据库" },
    ],
    edges: [{ id: "read", source: "service", target: "store" }],
  },
  layout: [
    { nodeId: "service", x: -30, y: 10.5 },
    { nodeId: "store", x: 300, y: 24 },
  ],
};

const registerAccount = async (email: string) => {
  const response = await register(
    new Request(`${ORIGIN}/api/mock/auth/register`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ username: "AC5 test", email, password: "test-password" }),
    }),
    { params: Promise.resolve({ action: "register" }) },
  );
  expect(response.status).toBe(201);
  const { data } = ApiResponseSchema(AuthResult).parse(await response.json());
  if (!data) throw new Error("注册未返回数据");
  return { userId: data.user.id, headers: { Authorization: `Bearer ${data.accessToken}` } };
};

const setupProject = async () => {
  const owner = await registerAccount("owner@example.com");
  const project = await createProject(owner.userId, { name: "资产测试" }, randomUUID());
  if (!project?.lastActiveConversationId) throw new Error("创建项目没有返回会话");

  const projectId = project.id;
  const assetPath = `${ORIGIN}/api/mock/projects/${projectId}/assets`;
  const save = (body: unknown, key = randomUUID(), headers = owner.headers) =>
    saveAsset(
      new Request(assetPath, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": key },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ projectId }) },
    );
  const read = (assetId: string, includeGraph?: boolean, headers = owner.headers) =>
    getAsset(
      new Request(`${assetPath}/${assetId}${includeGraph === undefined ? "" : `?includeGraph=${includeGraph}`}`, { headers }),
      { params: Promise.resolve({ projectId, assetId }) },
    );

  return { ...owner, project, conversationId: project.lastActiveConversationId, save, read };
};

const readCreatedAsset = async (response: Response) => {
  expect(response.status).toBe(201);
  const payload = ApiResponseSchema(AssetMeta).parse(await response.json());
  if (!payload.data) throw new Error("保存资产未返回数据");
  return { asset: payload.data, traceId: payload.traceId };
};

describe("local project asset endpoints", () => {
  beforeEach(async ({ onTestFinished }) => {
    const temporaryRoot = await realpath(tmpdir());
    const directory = await mkdtemp(join(temporaryRoot, MOCK_DIRECTORY_PREFIX));
    vi.stubEnv("ARCHFLOW_MOCK_DIR", directory);
    onTestFinished(async () => {
      vi.unstubAllEnvs();
      const target = await realpath(directory);
      if (dirname(target) === temporaryRoot && basename(target).startsWith(MOCK_DIRECTORY_PREFIX)) {
        await rm(target, { recursive: true, force: true, maxRetries: 3 });
      }
    });
  });

  it("lists the new asset immediately and preserves its graph and positions when the draft changes", async () => {
    const { userId, conversationId, project, save, read } = await setupProject();
    const { graph, layout } = SNAPSHOT;
    await saveConversationDraft(userId, conversationId, { graph, layout, baseVersion: 0 });
    const { asset } = await readCreatedAsset(await save(SNAPSHOT));

    const [projectInTree] = await listProjectNodes(userId);
    expect(projectInTree.assets[0]).toEqual({ id: asset.id, name: SNAPSHOT.name, createdAt: asset.createdAt });

    await saveConversationDraft(userId, conversationId, {
      graph: { nodes: [{ id: "web", type: "client", label: "新入口" }], edges: [] },
      layout: [{ nodeId: "web", x: 40, y: -50 }],
      baseVersion: 1,
    });

    const response = await read(asset.id);
    expect(response.status).toBe(200);
    expect(ApiResponseSchema(Asset).parse(await response.json()).data).toEqual({
      ...asset, graph, layout,
    });
    const metadata = await read(asset.id, false);
    expect(metadata.status).toBe(200);
    const metadataPayload = await metadata.json();
    expect(metadataPayload.data).toEqual(asset);

    const fromAsset = await createConversation(userId, project.id, { initialAssetId: asset.id });
    expect(fromAsset).toMatchObject({ status: "created", conversation: { draftGraph: graph, draftLayout: layout } });
  });

  it("replays a retried save and rejects a different snapshot under the same key", async () => {
    const { userId, save } = await setupProject();
    const key = randomUUID();
    const results = await Promise.all([save(SNAPSHOT, key), save(SNAPSHOT, key)]);
    const [first, replay] = await Promise.all(results.map(readCreatedAsset));
    expect(replay).toEqual(first);

    const mismatch = await save({ ...SNAPSHOT, name: "另一个名称" }, key);
    expect(mismatch.status).toBe(422);
    expect(await mismatch.json()).toMatchObject({ code: ERROR_CODES.IDEMPOTENCY_KEY_REUSED });
    const [project] = await listProjectNodes(userId);
    expect(project.assets.filter(({ name }) => name === SNAPSHOT.name)).toHaveLength(1);
  });

  it("restricts saving and opening assets to the project owner", async () => {
    const { save, read } = await setupProject();
    const outsider = await registerAccount("outsider@example.com");
    const { asset } = await readCreatedAsset(await save(SNAPSHOT));

    const saveElsewhere = await save(SNAPSHOT, randomUUID(), outsider.headers);
    expect(saveElsewhere.status).toBe(404);
    expect(await saveElsewhere.json()).toMatchObject({ code: ERROR_CODES.PROJECT_NOT_FOUND });
    const openElsewhere = await read(asset.id, true, outsider.headers);
    expect(openElsewhere.status).toBe(404);
    expect(await openElsewhere.json()).toMatchObject({ code: ERROR_CODES.ASSET_NOT_FOUND });
  });

  it("rejects positions for missing nodes and still opens the legacy sample asset", async () => {
    const { project, save, read } = await setupProject();
    const invalid = await save({ ...SNAPSHOT, layout: [{ nodeId: "missing", x: 0, y: 0 }] });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ code: ERROR_CODES.GRAPH_INVALID });

    const previous = await read(project.assets[0].id);
    expect(previous.status).toBe(200);
    const { data } = ApiResponseSchema(Asset).parse(await previous.json());
    expect(data?.graph.nodes[0]).toMatchObject({ id: "node-client", type: "client" });
    expect(data?.graph.edges[0]).toMatchObject({ source: "node-client", target: "node-gateway" });
  });
});
