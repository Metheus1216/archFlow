"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type OnNodesChange,
} from "@xyflow/react";
import type { DraftLayout, Graph, LooseGraph } from "@arch-flow/shared";
import { readMockGraph } from "@/lib/read-mock-graph";
import {
  CANVAS_NODE_HEIGHT,
  CANVAS_NODE_WIDTH,
  layoutDraftGraph,
} from "./canvas-layout";
import "@xyflow/react/dist/style.css";

type GraphCanvasProps = {
  graph: LooseGraph;
  positions?: DraftLayout;
  onPositionsChange?: (positions: DraftLayout) => void;
  onPositionEditStart?: () => void;
  onPositionEditEnd?: () => void;
};

const makeNodes = (graph: Graph, positions?: DraftLayout): Node[] => {
  const layout = layoutDraftGraph(graph, positions);
  return graph.nodes.map(({ id, label, description }, index) => {
    const { x, y } = layout[index];
    return {
      id,
      position: { x, y },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: (
          <span
            className="line-clamp-2 break-all leading-4"
            title={description ? `${label}\n${description}` : label}
          >
            {label}
          </span>
        ),
      },
      ariaLabel: label,
      style: {
        width: CANVAS_NODE_WIDTH,
        height: CANVAS_NODE_HEIGHT,
        display: "grid",
        alignItems: "center",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        color: "var(--card-foreground)",
      },
    };
  });
};

const makeEdges = (graph: Graph): Edge[] =>
  graph.edges.map(({ id, source, target, label }) => ({
    id,
    source,
    target,
    label,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: "var(--edge)" },
    labelStyle: { fill: "var(--foreground)" },
    labelBgStyle: { fill: "var(--background)" },
  }));

const FlowCanvas = ({
  graph,
  positions,
  onPositionsChange,
  onPositionEditStart,
  onPositionEditEnd,
}: Omit<GraphCanvasProps, "graph"> & { graph: Graph }) => {
  const inputNodes = useMemo(
    () => makeNodes(graph, positions),
    [graph, positions],
  );
  const edges = useMemo(() => makeEdges(graph), [graph]);
  const [nodes, setNodes] = useState(inputNodes);
  const liveNodes = useRef(inputNodes);
  const appliedInput = useRef(inputNodes);
  const dragOrigin = useRef<Node[] | null>(null);

  useLayoutEffect(() => {
    if (dragOrigin.current || appliedInput.current === inputNodes) return;
    appliedInput.current = inputNodes;
    const currentById = new Map(
      liveNodes.current.map((node) => [node.id, node]),
    );
    const next = inputNodes.map((node) => ({
      ...currentById.get(node.id),
      ...node,
      dragging: false,
    }));
    liveNodes.current = next;
    setNodes(next);
  }, [inputNodes, nodes]);

  const handleNodesChange: OnNodesChange = useCallback(
    (changes) => {
      const before = liveNodes.current;
      const after = applyNodeChanges(changes, before);
      liveNodes.current = after;
      setNodes(after);

      const moves = changes.filter((change) => change.type === "position");
      if (moves.length === 0) return;

      if (moves.some((change) => change.dragging)) {
        if (!dragOrigin.current && onPositionsChange) {
          dragOrigin.current = before;
          onPositionEditStart?.();
        }
        return;
      }

      const origin = dragOrigin.current;
      const baseline = origin ?? before;
      dragOrigin.current = null;
      const moved = after.some(
        ({ position }, index) =>
          position.x !== baseline[index]?.position.x ||
          position.y !== baseline[index]?.position.y,
      );
      if (!origin && (!onPositionsChange || !moved)) return;
      if (!origin) onPositionEditStart?.();
      if (moved) {
        onPositionsChange?.(
          after.map(({ id, position }) => ({
            nodeId: id,
            ...position,
          })),
        );
      }
      onPositionEditEnd?.();
    },
    [onPositionEditEnd, onPositionEditStart, onPositionsChange],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      nodesDraggable={Boolean(onPositionsChange)}
      nodesConnectable={false}
      deleteKeyCode={null}
      onNodesChange={handleNodesChange}
      colorMode="system"
      proOptions={{ hideAttribution: true }}
    >
      <Controls position="bottom-right" showInteractive={false} />
    </ReactFlow>
  );
};

export const GraphCanvas = ({ graph, ...props }: GraphCanvasProps) => {
  const parsed = useMemo(() => readMockGraph(graph), [graph]);
  if (!parsed) {
    return (
      <p role="status" className="p-4 text-xs text-muted-foreground">
        无法显示这张架构图。
      </p>
    );
  }

  return parsed.nodes.length ? <FlowCanvas graph={parsed} {...props} /> : null;
};
