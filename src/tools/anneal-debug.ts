import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  initializeAnneal,
  stepAnneal,
  runAnneal,
  type AnnealProblem,
  type AnnealStateSnapshot,
  type AnnealTransition,
} from "../layout/anneal/engine";
import { computeCost, type CostBreakdown as LayoutCostBreakdown } from "../layout/cost/cost";
import { buildDefaultFixtureConfig } from "../layout/fixtures/defaultPlateGraph";
import { appendHistoryPoint, historyToCsv, historyToJson, type HistoryPoint } from "../layout/debug/history";

interface AnnealDebugProblemConfig {
  initialLayout: number[];
  maxNudgeStep: number;
  initialTemperature: number;
  coolingRate: number;
  minTemperature: number;
  transitionBufferSize: number;
  enableBlockShift: boolean;
}

interface AnnealDebugRecord {
  version: 1;
  seed: number;
  fixture: "default" | "manual";
  cursor: number;
  problem: AnnealDebugProblemConfig;
  snapshots: AnnealStateSnapshot[];
  transitions: AnnealTransition[];
  history: HistoryPoint[];
}

const DEFAULT_STATE_PATH = ".anneal-debug-state.json";

function parseNumberFlag(args: string[], name: string, fallback: number): number {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) {
    return fallback;
  }

  const parsed = Number(args[index + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntFlag(args: string[], name: string, fallback: number): number {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) {
    return fallback;
  }

  const parsed = Number.parseInt(args[index + 1], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function loadRecord(pathArg?: string): AnnealDebugRecord {
  const path = resolve(pathArg ?? DEFAULT_STATE_PATH);
  if (!existsSync(path)) {
    throw new Error(`No state file found at ${path}. Run 'init' first.`);
  }

  return JSON.parse(readFileSync(path, "utf8")) as AnnealDebugRecord;
}

function saveRecord(record: AnnealDebugRecord, pathArg?: string): void {
  const path = resolve(pathArg ?? DEFAULT_STATE_PATH);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function countInversions(values: readonly number[]): number {
  let inversions = 0;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (values[i] > values[j]) {
        inversions += 1;
      }
    }
  }

  return inversions;
}

function asEngineCost(cost: LayoutCostBreakdown) {
  return {
    total: cost.total,
    components: {
      L: cost.L,
      X: cost.X,
      B: cost.B,
      F_out: cost.F_out,
      F_down: cost.F_down,
      F: cost.F,
      S_span: cost.S_span,
      S_waste: cost.S_waste,
      S: cost.S,
    },
  };
}

function historyCostFromEngine(snapshot: AnnealStateSnapshot): LayoutCostBreakdown {
  const c = snapshot.costBreakdown.components;
  return {
    total: snapshot.costBreakdown.total,
    L: c.L ?? 0,
    X: c.X ?? 0,
    B: c.B ?? 0,
    F_out: c.F_out ?? 0,
    F_down: c.F_down ?? 0,
    F: c.F ?? 0,
    S_span: c.S_span ?? 0,
    S_waste: c.S_waste ?? 0,
    S: c.S ?? 0,
  };
}

function buildProblem(config: AnnealDebugProblemConfig): AnnealProblem {
  return {
    ...config,
    evaluateCost: (layout) => {
      const spans = layout.slice(1).map((value, i) => value - layout[i]);
      const bends = spans.reduce((sum, span) => sum + (Math.abs(span) > 1 ? 1 : 0), 0);
      const flowDownViolations = spans.reduce((sum, span) => sum + (span < 0 ? 1 : 0), 0);
      const flowOutViolations = layout.reduce((sum, value) => sum + (value < 0 ? 1 : 0), 0);
      const crossings = countInversions(layout);
      const waste = layout.reduce((sum, value) => sum + Math.max(0, Math.abs(value) - 6), 0);

      const breakdown = computeCost(
        { positions: layout, spans, waste },
        { crossings, bends, flowOutViolations, flowDownViolations, spans },
      );

      return asEngineCost(breakdown);
    },
  };
}

function createDefaultFixtureLayout(): number[] {
  const fixture = buildDefaultFixtureConfig();
  return fixture.nodes.map((node, index) => {
    const base = fixture.nodeSizeCellsByType[node.type] ?? 1;
    const cardinality = node.dims.reduce((acc, dim) => acc * (fixture.cardinalities[dim as "c" | "p" | "t"] ?? 1), 1);
    return base * cardinality + (index % 3);
  });
}

function cloneSnapshot(snapshot: AnnealStateSnapshot): AnnealStateSnapshot {
  return {
    iteration: snapshot.iteration,
    temperature: snapshot.temperature,
    layout: [...snapshot.layout],
    costBreakdown: {
      total: snapshot.costBreakdown.total,
      components: { ...snapshot.costBreakdown.components },
    },
    rngState: { ...snapshot.rngState },
  };
}

function stateAtCursor(record: AnnealDebugRecord) {
  const problem = buildProblem(record.problem);
  const state = initializeAnneal(problem, record.seed);
  if (record.cursor > 0) {
    runAnneal(state, record.cursor);
  }

  return state;
}

function trimToCursor(record: AnnealDebugRecord): AnnealDebugRecord {
  const maxTransitionCount = Math.max(0, record.cursor);
  return {
    ...record,
    snapshots: record.snapshots.slice(0, record.cursor + 1),
    transitions: record.transitions.slice(0, maxTransitionCount),
    history: record.history.slice(0, maxTransitionCount),
  };
}

function summarizeTransition(transition: AnnealTransition): string {
  const detail =
    transition.proposal.type === "nudge"
      ? `index=${transition.proposal.index} delta=${transition.proposal.delta}`
      : transition.proposal.type === "swap"
        ? `a=${transition.proposal.a} b=${transition.proposal.b}`
        : transition.proposal.type === "reinsert"
          ? `from=${transition.proposal.from} to=${transition.proposal.to}`
          : `start=${transition.proposal.start} end=${transition.proposal.end} shift=${transition.proposal.shift}`;

  return [
    `iter=${transition.after.iteration}`,
    `temp=${transition.after.temperature.toFixed(4)}`,
    `move=${transition.proposal.type}(${detail})`,
    `delta=${transition.deltaCost.toFixed(4)}`,
    `accepted=${transition.accepted}`,
    `reason=${transition.reason}`,
    `total=${transition.after.costBreakdown.total.toFixed(4)}`,
  ].join(" ");
}

function initCommand(args: string[]): void {
  const seed = parseIntFlag(args, "--seed", 1337);
  const loadDefaultFixture = hasFlag(args, "--load-default-fixture");
  const initialLayout = loadDefaultFixture
    ? createDefaultFixtureLayout()
    : [4, 2, 7, 1, 3, 6, 8, 5];

  const problem: AnnealDebugProblemConfig = {
    initialLayout,
    maxNudgeStep: parseIntFlag(args, "--max-nudge-step", 2),
    initialTemperature: parseNumberFlag(args, "--initial-temperature", 12),
    coolingRate: parseNumberFlag(args, "--cooling-rate", 0.992),
    minTemperature: parseNumberFlag(args, "--min-temperature", 0.0001),
    transitionBufferSize: parseIntFlag(args, "--buffer", 256),
    enableBlockShift: !hasFlag(args, "--disable-block-shift"),
  };

  const anneal = initializeAnneal(buildProblem(problem), seed);
  const snapshot = cloneSnapshot(anneal);

  const record: AnnealDebugRecord = {
    version: 1,
    seed,
    fixture: loadDefaultFixture ? "default" : "manual",
    cursor: 0,
    problem,
    snapshots: [snapshot],
    transitions: [],
    history: [],
  };

  const statePath = args.includes("--state") ? args[args.indexOf("--state") + 1] : undefined;
  saveRecord(record, statePath);
  console.log(`initialized state at iter=0 total=${snapshot.costBreakdown.total.toFixed(4)} seed=${seed}`);
  if (loadDefaultFixture) {
    console.log("loaded default fixture layout");
  }
}

function stepLike(record: AnnealDebugRecord, steps: number): AnnealDebugRecord {
  let next = trimToCursor(record);
  const state = stateAtCursor(next);

  for (let i = 0; i < steps; i += 1) {
    const transition = stepAnneal(state);
    next.transitions.push(transition);
    next.snapshots.push(cloneSnapshot(state));
    next.history = appendHistoryPoint(next.history, {
      iter: transition.after.iteration,
      temp: transition.after.temperature,
      accepted: transition.accepted,
      moveType: transition.proposal.type,
      cost: historyCostFromEngine(transition.after),
    });
    next.cursor = transition.after.iteration;
    console.log(summarizeTransition(transition));
  }

  return next;
}

function stepCommand(args: string[]): void {
  const statePath = args.includes("--state") ? args[args.indexOf("--state") + 1] : undefined;
  const record = loadRecord(statePath);
  const next = stepLike(record, 1);
  saveRecord(next, statePath);
}

function runCommand(args: string[]): void {
  const n = Math.max(0, Number.parseInt(args[0] ?? "0", 10));
  const statePath = args.includes("--state") ? args[args.indexOf("--state") + 1] : undefined;
  const record = loadRecord(statePath);
  const next = stepLike(record, n);
  saveRecord(next, statePath);
}

function rewindCommand(args: string[]): void {
  const steps = Math.max(1, Number.parseInt(args[0] ?? "1", 10));
  const statePath = args.includes("--state") ? args[args.indexOf("--state") + 1] : undefined;
  const record = loadRecord(statePath);

  record.cursor = Math.max(0, record.cursor - steps);
  saveRecord(record, statePath);
  const snapshot = record.snapshots[record.cursor];
  console.log(`rewound to iter=${snapshot.iteration} total=${snapshot.costBreakdown.total.toFixed(4)}`);
}

function jumpCommand(args: string[]): void {
  const target = Number.parseInt(args[0] ?? "0", 10);
  const statePath = args.includes("--state") ? args[args.indexOf("--state") + 1] : undefined;
  const record = loadRecord(statePath);
  const clamped = Math.max(0, Math.min(target, record.snapshots.length - 1));

  record.cursor = clamped;
  saveRecord(record, statePath);
  const snapshot = record.snapshots[record.cursor];
  console.log(`jumped to iter=${snapshot.iteration} total=${snapshot.costBreakdown.total.toFixed(4)}`);
}

function exportCommand(args: string[]): void {
  const format = (args[0] ?? "json").toLowerCase();
  const outPath = args[1] ?? `anneal-debug-history.${format === "csv" ? "csv" : "json"}`;
  const statePath = args.includes("--state") ? args[args.indexOf("--state") + 1] : undefined;
  const record = loadRecord(statePath);

  if (format === "csv") {
    writeFileSync(resolve(outPath), `${historyToCsv(record.history)}\n`, "utf8");
  } else {
    writeFileSync(resolve(outPath), `${historyToJson(record.history)}\n`, "utf8");
  }

  console.log(`exported ${record.history.length} history rows to ${resolve(outPath)}`);
}

function printUsage(): void {
  console.log(`anneal-debug commands:
  init [--load-default-fixture] [--seed N] [--state path]
  step [--state path]
  run N [--state path]
  rewind [N] [--state path]
  jump ITER [--state path]
  export [json|csv] [outPath] [--state path]`);
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help") {
    printUsage();
    return;
  }

  if (command === "init") {
    initCommand(rest);
    return;
  }

  if (command === "step") {
    stepCommand(rest);
    return;
  }

  if (command === "run") {
    runCommand(rest);
    return;
  }

  if (command === "rewind") {
    rewindCommand(rest);
    return;
  }

  if (command === "jump") {
    jumpCommand(rest);
    return;
  }

  if (command === "export") {
    exportCommand(rest);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main(process.argv.slice(2));
