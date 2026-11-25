import { GraphInput, MockGraph, type LooseGraph } from "@arch-flow/shared";

const SVG_COORDINATE = String.raw`([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)`;
const SVG_POINT = String.raw`${SVG_COORDINATE}(?:\s*,\s*|\s+)${SVG_COORDINATE}`;
const SVG_STRAIGHT_EDGE = new RegExp(
  String.raw`^M\s*${SVG_POINT}\s*L\s*${SVG_POINT}$`,
  "u",
);

export const readMockGraph = (graph: LooseGraph | null): GraphInput | null => {
  const canonical = GraphInput.safeParse(graph);
  if (canonical.success) return canonical.data;

  const legacy = MockGraph.safeParse(graph);
  if (!legacy.success) return null;
  const { nodes, edges } = legacy.data;
  const nodesByPosition = new Map(
    nodes.map(({ id, left, top }) => [`${left} ${top}`, id]),
  );
  if (nodesByPosition.size !== nodes.length) return null;

  const convertedEdges = edges.flatMap(({ id, path }) => {
    const coordinates = SVG_STRAIGHT_EDGE.exec(path.trim());
    if (!coordinates) return [];
    const [, startX, startY, endX, endY] = coordinates;
    const source = nodesByPosition.get(`${Number(startX)} ${Number(startY)}`);
    const target = nodesByPosition.get(`${Number(endX)} ${Number(endY)}`);
    return source && target ? [{ id, source, target }] : [];
  });
  if (convertedEdges.length !== edges.length) return null;

  const converted = GraphInput.safeParse({
    nodes: nodes.map(({ id, kind, label, meta }) => ({
      id,
      type: kind,
      label,
      description: meta ?? undefined,
    })),
    edges: convertedEdges,
  });
  return converted.success ? converted.data : null;
};
