export interface DimDecl {
  id: string;
  label?: string;
  description?: string;
}

export interface DistributionMetadata {
  family?: string;
  parameters?: Record<string, string | number | boolean | null>;
  notes?: string;
}

export interface NodeTemplate {
  id: string;
  type: string;
  /**
   * Ordered dimensions as declared by the template.
   * Use {@link normalizeDims} when deriving plate keys.
   */
  dims: string[];
  symbol?: string;
  distribution?: DistributionMetadata;
}

export interface EdgeTemplate {
  sourceTemplateId: string;
  targetTemplateId: string;
  directed?: boolean;
}

export interface PlateHierarchy {
  /** Canonical key generated from sorted unique dim ids. */
  key: string;
  /** Sorted + unique dim ids. */
  dims: string[];
  /** Plate nesting path from outermost to innermost. */
  path: string[];
}

export interface ExpandedNode {
  instanceId: string;
  templateId: string;
  indexTuple: number[];
  platePath: string[];
  sizeCells: number;
}

export interface ExpandedEdge {
  sourceInstanceId: string;
  targetInstanceId: string;
  templateEdgeId: string;
}

/**
 * Debug structure that keeps both template-level and instance-level graphs.
 */
export interface GraphIR {
  templateGraph: {
    dims: DimDecl[];
    nodes: NodeTemplate[];
    edges: EdgeTemplate[];
  };
  instanceGraph: {
    nodes: ExpandedNode[];
    edges: ExpandedEdge[];
  };
  plateHierarchies: PlateHierarchy[];
}

/**
 * Normalize dimensions into a deterministic set-like ordering.
 * Example: ["a", "b"] and ["b", "a"] both map to ["a", "b"].
 */
export function normalizeDims(dims: readonly string[]): string[] {
  return [...new Set(dims)].sort((a, b) => a.localeCompare(b));
}

/**
 * Stable plate key used for set-based uniqueness.
 */
export function plateKeyForDims(dims: readonly string[]): string {
  return normalizeDims(dims).join("|");
}

/**
 * Infer unique plate hierarchies from template node dimensions.
 * - Uniqueness is set-based (order-insensitive).
 * - Returned hierarchies are sorted by plate key for stable debugging output.
 */
export function inferPlateHierarchies(templates: readonly NodeTemplate[]): PlateHierarchy[] {
  const byKey = new Map<string, string[]>();

  for (const template of templates) {
    const dims = normalizeDims(template.dims);
    const key = dims.join("|");

    if (!byKey.has(key)) {
      byKey.set(key, dims);
    }
  }

  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, dims]) => ({
      key,
      dims,
      path: dims,
    }));
}
