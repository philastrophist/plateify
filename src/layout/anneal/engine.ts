export interface CostBreakdown {
  total: number;
  components: Record<string, number>;
}

export interface AnnealRngState {
  seed: number;
}

export interface AnnealProblem {
  initialLayout: number[];
  evaluateCost: (layout: readonly number[]) => CostBreakdown;
  maxNudgeStep?: number;
  initialTemperature?: number;
  coolingRate?: number;
  minTemperature?: number;
  transitionBufferSize?: number;
  captureFullTrace?: boolean;
  /** Enable the optional block-shift move in the proposal distribution. */
  enableBlockShift?: boolean;
}

export interface TransitionRingBuffer {
  capacity: number;
  head: number;
  size: number;
  entries: AnnealTransition[];
}

export interface AnnealStateSnapshot {
  iteration: number;
  temperature: number;
  layout: number[];
  costBreakdown: CostBreakdown;
  rngState: AnnealRngState;
}

export interface AnnealState extends AnnealStateSnapshot {
  problem: AnnealProblem;
  transitionBuffer: TransitionRingBuffer;
  fullTraceEnabled: boolean;
  fullTrace: AnnealTransition[];
}

interface AnnealMoveBase {
  rngStateAfterProposal: AnnealRngState;
}

export type AnnealMove =
  | (AnnealMoveBase & {
      type: "nudge";
      index: number;
      delta: number;
    })
  | (AnnealMoveBase & {
      type: "swap";
      a: number;
      b: number;
    })
  | (AnnealMoveBase & {
      type: "reinsert";
      from: number;
      to: number;
    })
  | (AnnealMoveBase & {
      type: "blockShift";
      start: number;
      end: number;
      shift: number;
    });

export interface AnnealTransition {
  proposal: AnnealMove;
  deltaCost: number;
  accepted: boolean;
  reason: "improved" | "equal" | "metropolis" | "rejected";
  before: AnnealStateSnapshot;
  after: AnnealStateSnapshot;
}

const DEFAULT_INITIAL_TEMPERATURE = 10;
const DEFAULT_COOLING_RATE = 0.995;
const DEFAULT_MIN_TEMPERATURE = 0.0001;
const DEFAULT_TRANSITION_BUFFER_SIZE = 256;

function sanitizeSeed(seed: number): number {
  const n = seed | 0;
  return n === 0 ? 0x6d2b79f5 : n;
}

function nextRng(state: AnnealRngState): [number, AnnealRngState] {
  let x = state.seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;

  const nextState = { seed: sanitizeSeed(x) };
  const value = (nextState.seed >>> 0) / 4294967296;
  return [value, nextState];
}

function randInt(maxExclusive: number, rngState: AnnealRngState): [number, AnnealRngState] {
  if (maxExclusive <= 0) {
    return [0, rngState];
  }

  const [u, nextState] = nextRng(rngState);
  return [Math.floor(u * maxExclusive), nextState];
}

function cloneSnapshot(state: AnnealStateSnapshot): AnnealStateSnapshot {
  return {
    iteration: state.iteration,
    temperature: state.temperature,
    layout: [...state.layout],
    costBreakdown: {
      total: state.costBreakdown.total,
      components: { ...state.costBreakdown.components },
    },
    rngState: { ...state.rngState },
  };
}

function cool(problem: AnnealProblem, temperature: number): number {
  const coolingRate = problem.coolingRate ?? DEFAULT_COOLING_RATE;
  const minTemperature = problem.minTemperature ?? DEFAULT_MIN_TEMPERATURE;
  return Math.max(minTemperature, temperature * coolingRate);
}

function makeRingBuffer(capacity: number): TransitionRingBuffer {
  return {
    capacity,
    head: 0,
    size: 0,
    entries: new Array(capacity),
  };
}

function appendTransition(state: AnnealState, transition: AnnealTransition): AnnealState {
  const ring = state.transitionBuffer;
  const nextEntries = [...ring.entries];
  nextEntries[ring.head] = transition;

  const nextRing: TransitionRingBuffer = {
    capacity: ring.capacity,
    head: (ring.head + 1) % ring.capacity,
    size: Math.min(ring.size + 1, ring.capacity),
    entries: nextEntries,
  };

  const nextTrace = state.fullTraceEnabled ? [...state.fullTrace, transition] : state.fullTrace;

  return {
    ...state,
    transitionBuffer: nextRing,
    fullTrace: nextTrace,
  };
}

export function initializeAnneal(problem: AnnealProblem, seed: number): AnnealState {
  const layout = [...problem.initialLayout];
  const costBreakdown = problem.evaluateCost(layout);
  const bufferSize = Math.max(1, problem.transitionBufferSize ?? DEFAULT_TRANSITION_BUFFER_SIZE);

  return {
    iteration: 0,
    temperature: Math.max(problem.initialTemperature ?? DEFAULT_INITIAL_TEMPERATURE, 0),
    layout,
    costBreakdown,
    rngState: { seed: sanitizeSeed(seed) },
    problem,
    transitionBuffer: makeRingBuffer(bufferSize),
    fullTraceEnabled: Boolean(problem.captureFullTrace),
    fullTrace: [],
  };
}

export function proposeMove(state: AnnealState): AnnealMove {
  const { layout, problem } = state;
  let rng = { ...state.rngState };

  const options: AnnealMove["type"][] = ["nudge", "swap", "reinsert"];
  if (problem.enableBlockShift) {
    options.push("blockShift");
  }

  let moveIndex;
  [moveIndex, rng] = randInt(options.length, rng);
  const moveType = options[moveIndex];

  if (moveType === "swap") {
    let a;
    [a, rng] = randInt(layout.length, rng);
    let b;
    [b, rng] = randInt(layout.length, rng);

    if (layout.length > 1) {
      while (b === a) {
        [b, rng] = randInt(layout.length, rng);
      }
    }

    return { type: "swap", a, b, rngStateAfterProposal: rng };
  }

  if (moveType === "reinsert") {
    let from;
    [from, rng] = randInt(layout.length, rng);
    let to;
    [to, rng] = randInt(layout.length, rng);

    return { type: "reinsert", from, to, rngStateAfterProposal: rng };
  }

  if (moveType === "blockShift") {
    let start;
    [start, rng] = randInt(layout.length, rng);
    let end;
    [end, rng] = randInt(layout.length, rng);
    if (start > end) {
      [start, end] = [end, start];
    }

    let shift;
    [shift, rng] = randInt(3, rng);
    return {
      type: "blockShift",
      start,
      end,
      shift: shift - 1,
      rngStateAfterProposal: rng,
    };
  }

  let index;
  [index, rng] = randInt(layout.length, rng);
  const stepMax = Math.max(1, problem.maxNudgeStep ?? 1);
  let deltaMagnitude;
  [deltaMagnitude, rng] = randInt(stepMax, rng);
  let signRoll;
  [signRoll, rng] = randInt(2, rng);

  const delta = (deltaMagnitude + 1) * (signRoll === 0 ? -1 : 1);
  return { type: "nudge", index, delta, rngStateAfterProposal: rng };
}

export function applyMove(state: AnnealState, move: AnnealMove): AnnealState {
  const nextLayout = [...state.layout];

  if (move.type === "nudge" && nextLayout.length > 0) {
    nextLayout[move.index] = nextLayout[move.index] + move.delta;
  } else if (move.type === "swap" && nextLayout.length > 1) {
    [nextLayout[move.a], nextLayout[move.b]] = [nextLayout[move.b], nextLayout[move.a]];
  } else if (move.type === "reinsert" && nextLayout.length > 1) {
    const [item] = nextLayout.splice(move.from, 1);
    nextLayout.splice(Math.min(move.to, nextLayout.length), 0, item);
  } else if (move.type === "blockShift" && nextLayout.length > 0 && move.shift !== 0) {
    const start = Math.max(0, Math.min(move.start, nextLayout.length - 1));
    const end = Math.max(start, Math.min(move.end, nextLayout.length - 1));
    const block = nextLayout.splice(start, end - start + 1);
    const insertion = Math.max(0, Math.min(start + move.shift, nextLayout.length));
    nextLayout.splice(insertion, 0, ...block);
  }

  return {
    ...state,
    layout: nextLayout,
    costBreakdown: state.problem.evaluateCost(nextLayout),
    rngState: { ...move.rngStateAfterProposal },
  };
}

export function acceptMove(state: AnnealState, candidate: AnnealState): AnnealTransition {
  const deltaCost = candidate.costBreakdown.total - state.costBreakdown.total;
  const before = cloneSnapshot(state);

  let accepted = false;
  let reason: AnnealTransition["reason"] = "rejected";
  let rngAfterAccept = { ...candidate.rngState };

  if (deltaCost < 0) {
    accepted = true;
    reason = "improved";
  } else if (deltaCost === 0) {
    accepted = true;
    reason = "equal";
  } else {
    const [u, nextRngState] = nextRng(candidate.rngState);
    rngAfterAccept = nextRngState;
    const metropolisCutoff = Math.exp(-deltaCost / Math.max(state.temperature, 1e-12));
    if (u < metropolisCutoff) {
      accepted = true;
      reason = "metropolis";
    }
  }

  const baseNext: AnnealStateSnapshot = {
    iteration: state.iteration + 1,
    temperature: cool(state.problem, state.temperature),
    layout: accepted ? [...candidate.layout] : [...state.layout],
    costBreakdown: accepted
      ? {
          total: candidate.costBreakdown.total,
          components: { ...candidate.costBreakdown.components },
        }
      : {
          total: state.costBreakdown.total,
          components: { ...state.costBreakdown.components },
        },
    rngState: rngAfterAccept,
  };

  return {
    proposal: {
      type: "nudge",
      index: 0,
      delta: 0,
      rngStateAfterProposal: { ...candidate.rngState },
    },
    deltaCost,
    accepted,
    reason,
    before,
    after: baseNext,
  };
}

function buildNextStateFromTransition(state: AnnealState, transition: AnnealTransition): AnnealState {
  return {
    ...state,
    iteration: transition.after.iteration,
    temperature: transition.after.temperature,
    layout: [...transition.after.layout],
    costBreakdown: {
      total: transition.after.costBreakdown.total,
      components: { ...transition.after.costBreakdown.components },
    },
    rngState: { ...transition.after.rngState },
  };
}

export function stepAnneal(state: AnnealState): AnnealTransition {
  const proposal = proposeMove(state);
  const candidate = applyMove(state, proposal);
  const acceptedTransition = acceptMove(state, candidate);

  const transition: AnnealTransition = {
    ...acceptedTransition,
    proposal,
  };

  const postStep = buildNextStateFromTransition(state, transition);
  const persisted = appendTransition(postStep, transition);

  state.iteration = persisted.iteration;
  state.temperature = persisted.temperature;
  state.layout = persisted.layout;
  state.costBreakdown = persisted.costBreakdown;
  state.rngState = persisted.rngState;
  state.transitionBuffer = persisted.transitionBuffer;
  state.fullTrace = persisted.fullTrace;

  return transition;
}

export function runAnneal(
  state: AnnealState,
  budget: number,
  onStep?: (transition: AnnealTransition, state: AnnealState) => void,
): AnnealState {
  const steps = Math.max(0, Math.floor(budget));
  for (let i = 0; i < steps; i += 1) {
    const transition = stepAnneal(state);
    if (onStep) {
      onStep(transition, state);
    }
  }

  return state;
}

export function exportTransitionRing(state: AnnealState): AnnealTransition[] {
  const { transitionBuffer } = state;
  const out: AnnealTransition[] = [];

  for (let i = 0; i < transitionBuffer.size; i += 1) {
    const index = (transitionBuffer.head - transitionBuffer.size + i + transitionBuffer.capacity) %
      transitionBuffer.capacity;
    const transition = transitionBuffer.entries[index];
    if (transition) {
      out.push(transition);
    }
  }

  return out;
}

export function exportFullTrace(state: AnnealState): AnnealTransition[] {
  return [...state.fullTrace];
}
