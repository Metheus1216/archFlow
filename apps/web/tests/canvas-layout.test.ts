import type { Graph } from "@arch-flow/shared";
import { expect, it } from "vitest";
import {
  CANVAS_NODE_HEIGHT,
  CANVAS_NODE_WIDTH,
  layoutDraftGraph,
} from "../components/workspace/canvas/canvas-layout";

it("lays out a linked pair left to right and keeps an isolated node addressable", () => {
  const graph: Graph = {
    nodes: [
      { id: "api", type: "service", label: "查询服务" },
      { id: "db", type: "database", label: "数据库" },
      { id: "__proto__", type: "cache", label: "独立缓存" },
    ],
    edges: [{ id: "query", source: "api", target: "db" }],
  };

  const [api, database, cache] = layoutDraftGraph(graph);

  expect([api.nodeId, database.nodeId, cache.nodeId]).toEqual([
    "api",
    "db",
    "__proto__",
  ]);
  expect(api.x).toBeLessThan(database.x);
  expect(Number.isFinite(cache.x) && Number.isFinite(cache.y)).toBe(true);
  expect([cache.x, cache.y]).not.toEqual([api.x, api.y]);
});

it("places an inserted node clear of an existing node's saved position", () => {
  const graph: Graph = {
    nodes: [
      { id: "gateway", type: "service", label: "网关" },
      { id: "cache", type: "cache", label: "缓存" },
      { id: "orders", type: "service", label: "订单服务" },
    ],
    edges: [
      { id: "read-cache", source: "gateway", target: "cache" },
      { id: "fetch-orders", source: "cache", target: "orders" },
    ],
  };
  const savedOrders = { nodeId: "orders", x: 290, y: 0 };

  const [, cache, orders] = layoutDraftGraph(graph, [savedOrders]);

  const overlapsSavedOrders =
    Math.abs(cache.x - savedOrders.x) < CANVAS_NODE_WIDTH &&
    Math.abs(cache.y - savedOrders.y) < CANVAS_NODE_HEIGHT;
  expect(overlapsSavedOrders).toBe(false);
  expect(orders).toEqual(savedOrders);
});
