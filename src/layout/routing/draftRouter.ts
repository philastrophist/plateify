export interface GridPoint {
  x: number;
  y: number;
}

export interface GridRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DraftRouterEdge {
  id: string;
  source: GridPoint;
  target: GridPoint;
}

export interface DraftRouterInput {
  edges: readonly DraftRouterEdge[];
  obstacles?: readonly GridRect[];
  blockedCells?: readonly GridPoint[];
  gridStep?: number;
  /**
   * Inflate obstacles by this many grid cells to keep routes off node borders.
   */
  obstaclePadding?: number;
}

export interface RoutedEdge {
  id: string;
  points: GridPoint[];
}

export interface RouteCost {
  length: number;
  bends: number;
  crossings: number;
  total: number;
}

export interface DraftRouterResult {
  mode: "draft";
  routes: RoutedEdge[];
  cost: RouteCost;
}

interface Cell {
  x: number;
  y: number;
}

const NEIGHBOR_DIRS: ReadonlyArray<Cell> = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: -1, y: 0 },
];

function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

function normalizeToCell(point: GridPoint, step: number): Cell {
  return {
    x: Math.round(point.x / step),
    y: Math.round(point.y / step),
  };
}

function denormalizeFromCell(cell: Cell, step: number): GridPoint {
  return {
    x: cell.x * step,
    y: cell.y * step,
  };
}

function buildBlockedSet(
  obstacles: readonly GridRect[],
  blockedCells: readonly GridPoint[],
  step: number,
  obstaclePadding: number,
): Set<string> {
  const blocked = new Set<string>();

  for (const point of blockedCells) {
    blocked.add(cellKey(normalizeToCell(point, step)));
  }

  for (const obstacle of obstacles) {
    const minX = Math.floor(obstacle.x / step) - obstaclePadding;
    const maxX = Math.ceil((obstacle.x + obstacle.width) / step) + obstaclePadding;
    const minY = Math.floor(obstacle.y / step) - obstaclePadding;
    const maxY = Math.ceil((obstacle.y + obstacle.height) / step) + obstaclePadding;

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        blocked.add(cellKey({ x, y }));
      }
    }
  }

  return blocked;
}

function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function reconstructPath(cameFrom: Map<string, string>, end: Cell): Cell[] {
  const path: Cell[] = [end];
  let cursor = cellKey(end);

  while (cameFrom.has(cursor)) {
    const prev = cameFrom.get(cursor);
    if (!prev) {
      break;
    }

    const [x, y] = prev.split(",").map((v) => Number(v));
    path.push({ x, y });
    cursor = prev;
  }

  return path.reverse();
}

function findPath(start: Cell, goal: Cell, blocked: Set<string>): Cell[] {
  if (cellKey(start) === cellKey(goal)) {
    return [start];
  }

  const open: Cell[] = [start];
  const cameFrom = new Map<string, string>();
  const g = new Map<string, number>([[cellKey(start), 0]]);
  const f = new Map<string, number>([[cellKey(start), manhattan(start, goal)]]);
  const openSet = new Set<string>([cellKey(start)]);

  while (open.length > 0) {
    open.sort((a, b) => {
      const fa = f.get(cellKey(a)) ?? Number.POSITIVE_INFINITY;
      const fb = f.get(cellKey(b)) ?? Number.POSITIVE_INFINITY;
      if (fa !== fb) {
        return fa - fb;
      }

      if (a.x !== b.x) {
        return a.x - b.x;
      }

      return a.y - b.y;
    });

    const current = open.shift() as Cell;
    const currentKey = cellKey(current);
    openSet.delete(currentKey);

    if (currentKey === cellKey(goal)) {
      return reconstructPath(cameFrom, current);
    }

    for (const dir of NEIGHBOR_DIRS) {
      const neighbor = {
        x: current.x + dir.x,
        y: current.y + dir.y,
      };
      const neighborKey = cellKey(neighbor);

      if (neighborKey !== cellKey(goal) && blocked.has(neighborKey)) {
        continue;
      }

      const tentativeG = (g.get(currentKey) ?? Number.POSITIVE_INFINITY) + 1;
      if (tentativeG >= (g.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      cameFrom.set(neighborKey, currentKey);
      g.set(neighborKey, tentativeG);
      f.set(neighborKey, tentativeG + manhattan(neighbor, goal));

      if (!openSet.has(neighborKey)) {
        open.push(neighbor);
        openSet.add(neighborKey);
      }
    }
  }

  return [start, goal];
}

function simplifyPath(path: readonly Cell[]): Cell[] {
  if (path.length <= 2) {
    return [...path];
  }

  const out: Cell[] = [path[0]];
  let prevDir: Cell | undefined;

  for (let i = 1; i < path.length; i += 1) {
    const prev = path[i - 1];
    const curr = path[i];
    const dir = { x: curr.x - prev.x, y: curr.y - prev.y };

    if (!prevDir || prevDir.x !== dir.x || prevDir.y !== dir.y) {
      out.push(prev);
      prevDir = dir;
    }
  }

  out.push(path[path.length - 1]);

  const deduped: Cell[] = [];
  for (const point of out) {
    if (deduped.length === 0 || cellKey(deduped[deduped.length - 1]) !== cellKey(point)) {
      deduped.push(point);
    }
  }

  return deduped;
}

function segmentCrossings(routes: readonly RoutedEdge[]): number {
  type Segment = { a: GridPoint; b: GridPoint; edgeId: string };
  const segments: Segment[] = [];

  for (const route of routes) {
    for (let i = 1; i < route.points.length; i += 1) {
      segments.push({ a: route.points[i - 1], b: route.points[i], edgeId: route.id });
    }
  }

  let count = 0;
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const s1 = segments[i];
      const s2 = segments[j];

      if (s1.edgeId === s2.edgeId) {
        continue;
      }

      const s1Vertical = s1.a.x === s1.b.x;
      const s2Vertical = s2.a.x === s2.b.x;
      if (s1Vertical === s2Vertical) {
        continue;
      }

      const vertical = s1Vertical ? s1 : s2;
      const horizontal = s1Vertical ? s2 : s1;

      const vx = vertical.a.x;
      const hy = horizontal.a.y;

      const vMinY = Math.min(vertical.a.y, vertical.b.y);
      const vMaxY = Math.max(vertical.a.y, vertical.b.y);
      const hMinX = Math.min(horizontal.a.x, horizontal.b.x);
      const hMaxX = Math.max(horizontal.a.x, horizontal.b.x);

      if (vx >= hMinX && vx <= hMaxX && hy >= vMinY && hy <= vMaxY) {
        count += 1;
      }
    }
  }

  return count;
}

export function evaluateRouteCost(routes: readonly RoutedEdge[]): RouteCost {
  let length = 0;
  let bends = 0;

  for (const route of routes) {
    for (let i = 1; i < route.points.length; i += 1) {
      length +=
        Math.abs(route.points[i].x - route.points[i - 1].x) +
        Math.abs(route.points[i].y - route.points[i - 1].y);
    }

    for (let i = 2; i < route.points.length; i += 1) {
      const d1 = {
        x: route.points[i - 1].x - route.points[i - 2].x,
        y: route.points[i - 1].y - route.points[i - 2].y,
      };
      const d2 = {
        x: route.points[i].x - route.points[i - 1].x,
        y: route.points[i].y - route.points[i - 1].y,
      };
      if (d1.x !== d2.x || d1.y !== d2.y) {
        bends += 1;
      }
    }
  }

  const crossings = segmentCrossings(routes);
  return {
    length,
    bends,
    crossings,
    total: length + bends * 5 + crossings * 20,
  };
}

export function routeDraft(input: DraftRouterInput): DraftRouterResult {
  const gridStep = Math.max(1, Math.floor(input.gridStep ?? 1));
  const obstaclePadding = Math.max(0, Math.floor(input.obstaclePadding ?? 1));
  const blocked = buildBlockedSet(
    input.obstacles ?? [],
    input.blockedCells ?? [],
    gridStep,
    obstaclePadding,
  );

  const routes: RoutedEdge[] = [];

  for (const edge of [...input.edges].sort((a, b) => a.id.localeCompare(b.id))) {
    const start = normalizeToCell(edge.source, gridStep);
    const goal = normalizeToCell(edge.target, gridStep);

    blocked.delete(cellKey(start));
    blocked.delete(cellKey(goal));

    const rawPath = findPath(start, goal, blocked);
    const simplified = simplifyPath(rawPath).map((cell) => denormalizeFromCell(cell, gridStep));
    routes.push({ id: edge.id, points: simplified });

    for (const point of rawPath) {
      if (cellKey(point) !== cellKey(start) && cellKey(point) !== cellKey(goal)) {
        blocked.add(cellKey(point));
      }
    }
  }

  return {
    mode: "draft",
    routes,
    cost: evaluateRouteCost(routes),
  };
}
