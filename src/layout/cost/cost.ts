export interface CostBreakdown {
  total: number;
  L: number;
  X: number;
  B: number;
  F_out: number;
  F_down: number;
  F: number;
  S_span: number;
  S_waste: number;
  S: number;
}

export interface LayoutCostInput {
  /**
   * Scalar coordinates used for compactness/length penalties.
   */
  positions?: readonly number[];
  /**
   * Segment spans already computed by upstream layout code.
   */
  spans?: readonly number[];
  /**
   * Optional precomputed waste term.
   */
  waste?: number;
}

export interface RoutingCostInput {
  /** Number of edge crossings. */
  crossings?: number;
  /** Number of bends. */
  bends?: number;
  /** Number of outward flow violations. */
  flowOutViolations?: number;
  /** Number of downward flow violations. */
  flowDownViolations?: number;
  /** Optional precomputed spans. */
  spans?: readonly number[];
}

export interface CostConfig {
  weights?: Partial<Record<Exclude<keyof CostBreakdown, "total">, number>>;
}

const ZERO_COST: CostBreakdown = {
  total: 0,
  L: 0,
  X: 0,
  B: 0,
  F_out: 0,
  F_down: 0,
  F: 0,
  S_span: 0,
  S_waste: 0,
  S: 0,
};

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

function weighted(value: number, weight = 1): number {
  return value * weight;
}

function finiteOrZero(value: number | undefined): number {
  return Number.isFinite(value) ? (value as number) : 0;
}

/**
 * Computes a full cost decomposition.
 *
 * Notes:
 * - Each non-total term is independently weighted.
 * - If both `layout.spans` and `routing.spans` are provided, layout spans are preferred.
 */
export function computeCost(
  layout: LayoutCostInput,
  routing: RoutingCostInput,
  config: CostConfig = {},
): CostBreakdown {
  const weights = config.weights ?? {};

  const positions = layout.positions ?? [];
  const spans = layout.spans ?? routing.spans ?? [];

  const baseL = sum(positions.map((p) => Math.abs(p)));
  const baseX = finiteOrZero(routing.crossings);
  const baseB = finiteOrZero(routing.bends);
  const baseFOut = finiteOrZero(routing.flowOutViolations);
  const baseFDown = finiteOrZero(routing.flowDownViolations);
  const baseSSpan = sum(spans.map((s) => Math.abs(s)));
  const baseSWaste = finiteOrZero(layout.waste);

  const L = weighted(baseL, weights.L);
  const X = weighted(baseX, weights.X);
  const B = weighted(baseB, weights.B);
  const F_out = weighted(baseFOut, weights.F_out);
  const F_down = weighted(baseFDown, weights.F_down);
  const F = weighted(baseFOut + baseFDown, weights.F);
  const S_span = weighted(baseSSpan, weights.S_span);
  const S_waste = weighted(baseSWaste, weights.S_waste);
  const S = weighted(baseSSpan + baseSWaste, weights.S);

  const total = L + X + B + F_out + F_down + F + S_span + S_waste + S;

  return {
    total,
    L,
    X,
    B,
    F_out,
    F_down,
    F,
    S_span,
    S_waste,
    S,
  };
}

export function computeDeltaCost(prev: CostBreakdown, next: CostBreakdown): CostBreakdown {
  return {
    total: next.total - prev.total,
    L: next.L - prev.L,
    X: next.X - prev.X,
    B: next.B - prev.B,
    F_out: next.F_out - prev.F_out,
    F_down: next.F_down - prev.F_down,
    F: next.F - prev.F,
    S_span: next.S_span - prev.S_span,
    S_waste: next.S_waste - prev.S_waste,
    S: next.S - prev.S,
  };
}

export function zeroCostBreakdown(): CostBreakdown {
  return { ...ZERO_COST };
}
