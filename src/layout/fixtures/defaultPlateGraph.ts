import { DimDecl, EdgeTemplate, NodeTemplate } from "../ir";

export interface DefaultFixtureOverrides {
  cardinalities?: Partial<Record<"c" | "p" | "t", number>>;
  nodeSizeCellsByType?: Partial<Record<string, number>>;
}

export interface DefaultFixtureConfig {
  dims: DimDecl[];
  nodes: NodeTemplate[];
  edges: EdgeTemplate[];
  cardinalities: Record<"c" | "p" | "t", number>;
  nodeSizeCellsByType: Record<string, number>;
}

export const DEFAULT_FIXTURE_DIMS: DimDecl[] = [
  { id: "c", label: "Condition" },
  { id: "p", label: "Participant" },
  { id: "t", label: "Time" },
];

export const DEFAULT_FIXTURE_CARDINALITIES: Record<"c" | "p" | "t", number> = {
  c: 2,
  p: 2,
  t: 3,
};

/**
 * Deterministic node sizing defaults (in grid cells) keyed by node type.
 */
export const DEFAULT_NODE_SIZE_CELLS_BY_TYPE: Record<string, number> = {
  source: 1,
  latent: 2,
  deterministic: 2,
  observed: 3,
  query: 2,
  auxiliary: 1,
};

export const DEFAULT_FIXTURE_NODES: NodeTemplate[] = [
  { id: "alpha", type: "source", dims: [] },
  { id: "beta", type: "source", dims: [] },
  { id: "gamma", type: "source", dims: [] },
  { id: "delta", type: "source", dims: [] },

  { id: "r_c", type: "latent", dims: ["c"], symbol: "r" },
  { id: "r_p", type: "latent", dims: ["p"], symbol: "r" },
  { id: "r_cp", type: "latent", dims: ["c", "p"], symbol: "r" },

  { id: "l_c", type: "latent", dims: ["c"], symbol: "l" },
  { id: "l_p", type: "latent", dims: ["p"], symbol: "l" },
  { id: "l_cp", type: "latent", dims: ["c", "p"], symbol: "l" },

  { id: "s_cpt", type: "deterministic", dims: ["c", "p", "t"], symbol: "s" },
  { id: "B_cpt", type: "observed", dims: ["c", "p", "t"], symbol: "B" },
  { id: "V_ct", type: "query", dims: ["c", "t"], symbol: "V" },
  { id: "T_c", type: "auxiliary", dims: ["c"], symbol: "T" },
  { id: "q_cpt", type: "query", dims: ["c", "p", "t"], symbol: "q" },

  { id: "K_cp", type: "auxiliary", dims: ["c", "p"], symbol: "K" },
  { id: "A_cp", type: "deterministic", dims: ["c", "p"], symbol: "A" },
];

export const DEFAULT_FIXTURE_EDGES: EdgeTemplate[] = [
  // alpha -> r[c,p] <- beta
  { sourceTemplateId: "alpha", targetTemplateId: "r_cp" },
  { sourceTemplateId: "beta", targetTemplateId: "r_cp" },

  // gamma -> l[c,p] <- delta
  { sourceTemplateId: "gamma", targetTemplateId: "l_cp" },
  { sourceTemplateId: "delta", targetTemplateId: "l_cp" },

  // r[c] -> r[c,p] <- r[p]
  { sourceTemplateId: "r_c", targetTemplateId: "r_cp" },
  { sourceTemplateId: "r_p", targetTemplateId: "r_cp" },

  // l[c] -> l[c,p] <- l[p]
  { sourceTemplateId: "l_c", targetTemplateId: "l_cp" },
  { sourceTemplateId: "l_p", targetTemplateId: "l_cp" },

  // r[c,p] -> s[c,p,t] -> B[c,p,t]
  { sourceTemplateId: "r_cp", targetTemplateId: "s_cpt" },
  { sourceTemplateId: "s_cpt", targetTemplateId: "B_cpt" },

  // l[c,p] -> B[c,p,t] -> V[c,t] <- T[c]
  { sourceTemplateId: "l_cp", targetTemplateId: "B_cpt" },
  { sourceTemplateId: "B_cpt", targetTemplateId: "V_ct" },
  { sourceTemplateId: "T_c", targetTemplateId: "V_ct" },

  // V[c,t] -> q[c,p,t] <- B[c,p,t]
  { sourceTemplateId: "V_ct", targetTemplateId: "q_cpt" },
  { sourceTemplateId: "B_cpt", targetTemplateId: "q_cpt" },

  // q[c,p,t] <- s[c,p,t]
  { sourceTemplateId: "s_cpt", targetTemplateId: "q_cpt" },

  // K[c,p] -> B[c,p,t] and K[c,p] -> A[c,p]
  { sourceTemplateId: "K_cp", targetTemplateId: "B_cpt" },
  { sourceTemplateId: "K_cp", targetTemplateId: "A_cp" },
];

export function buildDefaultFixtureConfig(
  overrides: DefaultFixtureOverrides = {},
): DefaultFixtureConfig {
  const cardinalities = {
    ...DEFAULT_FIXTURE_CARDINALITIES,
    ...overrides.cardinalities,
  };

  const nodeSizeCellsByType = {
    ...DEFAULT_NODE_SIZE_CELLS_BY_TYPE,
    ...overrides.nodeSizeCellsByType,
  };

  return {
    dims: DEFAULT_FIXTURE_DIMS.map((dim) => ({ ...dim })),
    nodes: DEFAULT_FIXTURE_NODES.map((node) => ({ ...node, dims: [...node.dims] })),
    edges: DEFAULT_FIXTURE_EDGES.map((edge) => ({ ...edge })),
    cardinalities,
    nodeSizeCellsByType,
  };
}
