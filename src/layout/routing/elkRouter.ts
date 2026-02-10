import {
  evaluateRouteCost,
  routeDraft,
  type DraftRouterInput,
  type DraftRouterResult,
  type GridPoint,
  type RouteCost,
} from "./draftRouter";

export interface ElkNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElkEdge {
  id: string;
  source: string;
  target: string;
}

export interface ElkSection {
  startPoint?: GridPoint;
  endPoint?: GridPoint;
  bendPoints?: GridPoint[];
}

export interface ElkLayoutEdge {
  id: string;
  sections?: ElkSection[];
}

export interface ElkGraph {
  id: string;
  layoutOptions?: Record<string, string>;
  children: ElkNode[];
  edges: ElkEdge[];
}

export interface ElkLayoutGraph {
  id: string;
  children: ElkNode[];
  edges: ElkLayoutEdge[];
}

export interface ElkRouterInput {
  nodes: readonly ElkNode[];
  edges: readonly ElkEdge[];
  draftInput?: DraftRouterInput;
  elkLayout?: (graph: ElkGraph) => Promise<ElkLayoutGraph>;
}

export interface ElkRouterResult {
  mode: "elk";
  routes: DraftRouterResult["routes"];
  cost: RouteCost;
  fallbackUsed: boolean;
}

function toElkGraph(input: ElkRouterInput): ElkGraph {
  return {
    id: "root",
    children: [...input.nodes],
    edges: [...input.edges],
    layoutOptions: {
      "org.eclipse.elk.algorithm": "layered",
      "org.eclipse.elk.edgeRouting": "ORTHOGONAL",
      "org.eclipse.elk.interactive": "true",
      "org.eclipse.elk.interactiveLayout": "true",
      "org.eclipse.elk.layered.considerModelOrder": "NODES_AND_EDGES",
    },
  };
}

function pointsFromSection(section: ElkSection): GridPoint[] {
  const out: GridPoint[] = [];

  if (section.startPoint) {
    out.push(section.startPoint);
  }

  for (const bend of section.bendPoints ?? []) {
    out.push(bend);
  }

  if (section.endPoint) {
    out.push(section.endPoint);
  }

  return out;
}

function uniqueConsecutive(points: readonly GridPoint[]): GridPoint[] {
  const out: GridPoint[] = [];

  for (const point of points) {
    if (
      out.length === 0 ||
      out[out.length - 1].x !== point.x ||
      out[out.length - 1].y !== point.y
    ) {
      out.push(point);
    }
  }

  return out;
}

export async function routeElk(input: ElkRouterInput): Promise<ElkRouterResult> {
  const draftFallback = routeDraft(
    input.draftInput ?? {
      edges: input.edges.map((edge) => {
        const sourceNode = input.nodes.find((node) => node.id === edge.source);
        const targetNode = input.nodes.find((node) => node.id === edge.target);
        return {
          id: edge.id,
          source: sourceNode ? { x: sourceNode.x, y: sourceNode.y } : { x: 0, y: 0 },
          target: targetNode ? { x: targetNode.x, y: targetNode.y } : { x: 0, y: 0 },
        };
      }),
    },
  );

  if (!input.elkLayout) {
    return {
      mode: "elk",
      routes: draftFallback.routes,
      cost: draftFallback.cost,
      fallbackUsed: true,
    };
  }

  const layout = await input.elkLayout(toElkGraph(input));
  const routes = layout.edges.map((edge) => {
    const allPoints = (edge.sections ?? []).flatMap(pointsFromSection);
    return {
      id: edge.id,
      points: uniqueConsecutive(allPoints),
    };
  });

  const normalized = routes.map((route) =>
    route.points.length >= 2
      ? route
      : draftFallback.routes.find((fallback) => fallback.id === route.id) ?? route,
  );

  return {
    mode: "elk",
    routes: normalized,
    cost: evaluateRouteCost(normalized),
    fallbackUsed: false,
  };
}
