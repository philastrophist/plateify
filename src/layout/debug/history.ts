import type { CostBreakdown } from "../cost/cost";

const COST_TERMS: (keyof CostBreakdown)[] = [
  "total",
  "L",
  "X",
  "B",
  "F_out",
  "F_down",
  "F",
  "S_span",
  "S_waste",
  "S",
];

export interface HistoryPoint extends CostBreakdown {
  iter: number;
  temp: number;
  accepted: boolean;
  moveType: string;
}

export interface AcceptancePoint {
  iter: number;
  acceptanceRatio: number;
  windowSize: number;
}

export interface TermTrendSummary {
  term: keyof CostBreakdown;
  start: number;
  end: number;
  min: number;
  max: number;
  mean: number;
  delta: number;
  slopePerIter: number;
  direction: "up" | "down" | "flat";
}

export interface HistoryTrendSummary {
  windowSize: number;
  points: number;
  terms: TermTrendSummary[];
}

export interface HistoryAppendInput {
  iter: number;
  temp: number;
  accepted: boolean;
  moveType: string;
  cost: CostBreakdown;
}

export function appendHistoryPoint(
  history: readonly HistoryPoint[],
  input: HistoryAppendInput,
): HistoryPoint[] {
  return [
    ...history,
    {
      iter: input.iter,
      temp: input.temp,
      accepted: input.accepted,
      moveType: input.moveType,
      ...input.cost,
    },
  ];
}

export function rollingAcceptanceRatio(
  history: readonly HistoryPoint[],
  windowSize = 50,
): AcceptancePoint[] {
  const safeWindow = Math.max(1, Math.floor(windowSize));
  const out: AcceptancePoint[] = [];

  for (let i = 0; i < history.length; i += 1) {
    const start = Math.max(0, i - safeWindow + 1);
    const window = history.slice(start, i + 1);
    const accepted = window.reduce((acc, p) => acc + (p.accepted ? 1 : 0), 0);

    out.push({
      iter: history[i].iter,
      acceptanceRatio: window.length === 0 ? 0 : accepted / window.length,
      windowSize: window.length,
    });
  }

  return out;
}

function summarizeTerm(
  term: keyof CostBreakdown,
  history: readonly HistoryPoint[],
  startIndex: number,
): TermTrendSummary {
  if (history.length === 0 || startIndex >= history.length) {
    return {
      term,
      start: 0,
      end: 0,
      min: 0,
      max: 0,
      mean: 0,
      delta: 0,
      slopePerIter: 0,
      direction: "flat",
    };
  }

  const window = history.slice(startIndex);
  const first = window[0][term];
  const last = window[window.length - 1][term];

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let total = 0;

  for (const point of window) {
    const value = point[term];
    min = Math.min(min, value);
    max = Math.max(max, value);
    total += value;
  }

  const delta = last - first;
  const firstIter = window[0].iter;
  const lastIter = window[window.length - 1].iter;
  const iterDelta = Math.max(1, lastIter - firstIter);
  const slopePerIter = delta / iterDelta;

  return {
    term,
    start: first,
    end: last,
    min,
    max,
    mean: total / window.length,
    delta,
    slopePerIter,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

export function summarizeCostTrends(
  history: readonly HistoryPoint[],
  windowSize = 200,
): HistoryTrendSummary {
  const safeWindow = Math.max(1, Math.floor(windowSize));
  const startIndex = Math.max(0, history.length - safeWindow);

  return {
    windowSize: safeWindow,
    points: Math.max(0, history.length - startIndex),
    terms: COST_TERMS.map((term) => summarizeTerm(term, history, startIndex)),
  };
}

export function historyToJson(history: readonly HistoryPoint[]): string {
  return JSON.stringify(history);
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes("\n") || value.includes('"')) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}

export function historyToCsv(history: readonly HistoryPoint[]): string {
  const headers: (keyof HistoryPoint)[] = ["iter", "temp", "accepted", "moveType", ...COST_TERMS];
  const lines = [headers.join(",")];

  for (const point of history) {
    const row = headers.map((header) => csvEscape(String(point[header])));
    lines.push(row.join(","));
  }

  return lines.join("\n");
}

export function acceptanceToCsv(points: readonly AcceptancePoint[]): string {
  const headers: (keyof AcceptancePoint)[] = ["iter", "acceptanceRatio", "windowSize"];
  const lines = [headers.join(",")];

  for (const point of points) {
    lines.push(headers.map((h) => String(point[h])).join(","));
  }

  return lines.join("\n");
}

export function trendSummaryToJson(summary: HistoryTrendSummary): string {
  return JSON.stringify(summary);
}
