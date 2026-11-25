import type { DraftLayout, Graph } from "@arch-flow/shared";
import dagre from "dagre";

export const CANVAS_NODE_WIDTH = 180;
export const CANVAS_NODE_HEIGHT = 56;
const CANVAS_NODE_GAP = 36;

export const layoutDraftGraph = (
  graph: Graph,
  savedPositions?: DraftLayout,
): DraftLayout => {
  const savedById = new Map(
    savedPositions?.map((position) => [position.nodeId, position]),
  );
  const occupied = graph.nodes
    .map(({ id }) => savedById.get(id))
    .filter((position) => position !== undefined);
  if (occupied.length === graph.nodes.length) return occupied;

  const layout = new dagre.graphlib.Graph({ multigraph: true })
    .setGraph({ rankdir: "LR", ranksep: 110, nodesep: CANVAS_NODE_GAP })
    .setDefaultEdgeLabel(() => ({}));
  for (const { id } of graph.nodes) {
    layout.setNode(`node:${id}`, {
      width: CANVAS_NODE_WIDTH,
      height: CANVAS_NODE_HEIGHT,
    });
  }
  for (const { id, source, target } of graph.edges) {
    layout.setEdge(`node:${source}`, `node:${target}`, {}, id);
  }
  dagre.layout(layout);

  return graph.nodes.map(({ id }) => {
    const savedPosition = savedById.get(id);
    if (savedPosition) return savedPosition;

    const point = layout.node(`node:${id}`);
    const x = point.x - CANVAS_NODE_WIDTH / 2;
    let y = point.y - CANVAS_NODE_HEIGHT / 2;
    while (
      occupied.some(
        (position) =>
          Math.abs(position.x - x) < CANVAS_NODE_WIDTH &&
          Math.abs(position.y - y) < CANVAS_NODE_HEIGHT,
      )
    ) {
      y += CANVAS_NODE_HEIGHT + CANVAS_NODE_GAP;
    }

    const position = { nodeId: id, x, y };
    occupied.push(position);
    return position;
  });
};
