import {
  PROJECT_TREE_ITEM_LIMIT,
  type Graph,
  type ProjectNode,
} from "@arch-flow/shared";
import { describe, expect, it } from "vitest";
import { captureAssetSave } from "../components/workspace/canvas/asset-save-snapshot";
import { mergeProjectAsset } from "../hooks/use-project-asset";

const createGraph = (): Graph => ({
  nodes: [
    { id: "web", type: "client", label: "Web" },
    { id: "api", type: "service", label: "API" },
  ],
  edges: [{ id: "request", source: "web", target: "api" }],
});

describe("canvas asset save", () => {
  it("captures the graph and complete displayed positions when the dialog opens", () => {
    const graph = createGraph();
    const layout = [{ nodeId: "web", x: 320, y: 88 }];
    const source = {
      ownerId: "owner",
      projectId: "project",
      title: "当前架构",
      graph,
      layout,
    };
    const snapshot = captureAssetSave(source);

    source.ownerId = "other-owner";
    source.projectId = "other-project";
    graph.nodes[0].label = "Updated Web";
    layout[0].x = 480;
    const submission = snapshot.prepare("发布架构");

    expect(submission).toMatchObject({
      ownerId: "owner",
      projectId: "project",
      input: {
        name: "发布架构",
        graph: createGraph(),
        layout: [
          { nodeId: "web", x: 320, y: 88 },
          { nodeId: "api", x: expect.any(Number), y: expect.any(Number) },
        ],
      },
    });
  });

  it("reuses the same key for the same normalized request within one snapshot", () => {
    const details = {
      ownerId: "owner",
      projectId: "project",
      title: "当前架构",
      graph: createGraph(),
    };
    const snapshot = captureAssetSave(details);
    const first = snapshot.prepare("版本一");
    const changed = snapshot.prepare("版本二");
    const retry = snapshot.prepare(" 版本一 ");

    expect(first?.idempotencyKey).toBeTruthy();
    expect(retry).toEqual(first);
    expect(changed?.idempotencyKey).not.toBe(first?.idempotencyKey);
    expect(captureAssetSave(details).prepare("版本一")?.idempotencyKey).not.toBe(
      first?.idempotencyKey,
    );
    expect(snapshot.prepare(" ")).toBeNull();
  });

  it("updates the matching project once per saved asset and caps its tree entries", () => {
    const createdAt = "2026-11-24T10:00:00.000Z";
    const oldAssets = Array.from({ length: PROJECT_TREE_ITEM_LIMIT }, (_, index) => ({
      id: `asset-${index}`,
      name: `版本 ${index}`,
      createdAt,
    }));
    const project: ProjectNode = {
      id: "project",
      name: "项目",
      description: null,
      createdAt,
      updatedAt: createdAt,
      lastActiveConversationId: null,
      assets: oldAssets,
      conversations: [],
      files: [],
    };
    const other = { ...project, id: "other" };
    const page = { items: [project, other], nextCursor: null, hasMore: false };
    const saved = {
      id: "new-asset",
      name: "新架构",
      createdAt: "2026-11-24T10:02:00.000Z",
      updatedAt: "2026-11-24T10:02:00.000Z",
    };

    const first = mergeProjectAsset(page, project.id, saved);
    const replay = mergeProjectAsset(first, project.id, saved);

    expect(replay).toEqual(first);
    expect(replay?.items[0].assets).toHaveLength(PROJECT_TREE_ITEM_LIMIT);
    expect(replay?.items[0].assets[0]).toEqual({
      id: saved.id,
      name: saved.name,
      createdAt: saved.createdAt,
    });
    expect(replay?.items[1]).toBe(other);
  });
});
