import { MockGraph, type Graph } from "@arch-flow/shared";

/**
 * 真实契约里的 Graph 内部结构仍是 TBD（服务端视为不透明 JSON）。
 * mock 阶段用 MockGraph 校验并渲染；解析失败按“没有画布”处理。
 */
export const parseMockGraph = (graph: Graph | null): MockGraph | null => {
  if (!graph) {
    return null;
  }

  const parsed = MockGraph.safeParse(graph);

  return parsed.success ? parsed.data : null;
};
