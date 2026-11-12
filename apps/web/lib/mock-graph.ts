import type {
  Graph,
  MockGraph,
  MockGraphEdge,
  MockGraphNode,
} from "@arch-flow/shared";

/**
 * 真实契约里的 Graph 内部结构仍是 TBD（服务端视为不透明 JSON）。
 * mock 阶段用这里的结构守卫代替 Zod 校验，避免把 zod 打进客户端首屏；
 * 服务端返回前已经按 MockGraph schema 校验过，这里只防止脏数据把渲染打崩。
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isMockGraphNode = (value: unknown): value is MockGraphNode =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.kind === "string" &&
  typeof value.eyebrow === "string" &&
  typeof value.label === "string" &&
  (value.meta === null || typeof value.meta === "string") &&
  typeof value.left === "number" &&
  typeof value.top === "number";

const isMockGraphEdge = (value: unknown): value is MockGraphEdge =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.path === "string";

/**
 * 解析失败按“没有画布”处理；未知 kind 的兜底在渲染层完成。
 */
export const parseMockGraph = (graph: Graph | null): MockGraph | null => {
  if (
    !graph ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges) ||
    !graph.nodes.every(isMockGraphNode) ||
    !graph.edges.every(isMockGraphEdge)
  ) {
    return null;
  }

  return { nodes: graph.nodes, edges: graph.edges };
};
