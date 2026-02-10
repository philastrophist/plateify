import {
  routeDraft,
  type DraftRouterInput,
  type DraftRouterResult,
  type RouteCost,
} from "./draftRouter";
import { routeElk, type ElkRouterInput, type ElkRouterResult } from "./elkRouter";

export type RouterMode = "draft" | "elk" | "hybrid";

export interface RouterStep {
  draft: DraftRouterInput;
  elk?: Omit<ElkRouterInput, "draftInput">;
  accepted?: boolean;
  label?: string;
}

export interface RouterFacadeInput {
  mode: RouterMode;
  step: RouterStep;
  stepsForHybrid?: readonly RouterStep[];
  hybridRescoreEveryAccepted?: number;
  score?: (cost: RouteCost) => number;
}

export interface RouteDebugTrace {
  stepIndex: number;
  label?: string;
  mode: RouterMode;
  accepted: boolean;
  draftCost: RouteCost;
  elkCost?: RouteCost;
  selectedCost: RouteCost;
  selectedScore: number;
}

export interface RouterFacadeResult {
  selected: DraftRouterResult | ElkRouterResult;
  trace: RouteDebugTrace[];
}

function toSelectedCost(cost: RouteCost): RouteCost {
  return {
    length: cost.length,
    bends: cost.bends,
    crossings: cost.crossings,
    total: cost.total,
  };
}

function scoreCost(cost: RouteCost, score?: (cost: RouteCost) => number): number {
  return score ? score(cost) : cost.total;
}

async function runHybrid(input: RouterFacadeInput): Promise<RouterFacadeResult> {
  const steps = input.stepsForHybrid ?? [input.step];
  const every = Math.max(1, Math.floor(input.hybridRescoreEveryAccepted ?? 10));
  let acceptedSinceElk = 0;

  let selected: DraftRouterResult | ElkRouterResult = routeDraft(steps[0].draft);
  const trace: RouteDebugTrace[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const accepted = Boolean(step.accepted);
    const draft = routeDraft(step.draft);

    let elk: ElkRouterResult | undefined;
    if (accepted) {
      acceptedSinceElk += 1;
    }

    const shouldRescoreWithElk = Boolean(step.elk) && (acceptedSinceElk >= every || i === steps.length - 1);
    if (shouldRescoreWithElk && step.elk) {
      elk = await routeElk({ ...step.elk, draftInput: step.draft });
      acceptedSinceElk = 0;
    }

    const selectedCost = elk?.cost ?? draft.cost;
    const selectedScore = scoreCost(selectedCost, input.score);

    trace.push({
      stepIndex: i,
      label: step.label,
      mode: "hybrid",
      accepted,
      draftCost: toSelectedCost(draft.cost),
      elkCost: elk ? toSelectedCost(elk.cost) : undefined,
      selectedCost: toSelectedCost(selectedCost),
      selectedScore,
    });

    selected = elk ?? draft;
  }

  return { selected, trace };
}

export async function routeWithFacade(input: RouterFacadeInput): Promise<RouterFacadeResult> {
  if (input.mode === "draft") {
    const draft = routeDraft(input.step.draft);
    return {
      selected: draft,
      trace: [
        {
          stepIndex: 0,
          label: input.step.label,
          mode: "draft",
          accepted: Boolean(input.step.accepted),
          draftCost: toSelectedCost(draft.cost),
          selectedCost: toSelectedCost(draft.cost),
          selectedScore: scoreCost(draft.cost, input.score),
        },
      ],
    };
  }

  if (input.mode === "elk") {
    const elk = await routeElk({ ...(input.step.elk ?? { nodes: [], edges: [] }), draftInput: input.step.draft });
    return {
      selected: elk,
      trace: [
        {
          stepIndex: 0,
          label: input.step.label,
          mode: "elk",
          accepted: Boolean(input.step.accepted),
          draftCost: toSelectedCost(routeDraft(input.step.draft).cost),
          elkCost: toSelectedCost(elk.cost),
          selectedCost: toSelectedCost(elk.cost),
          selectedScore: scoreCost(elk.cost, input.score),
        },
      ],
    };
  }

  return runHybrid(input);
}
