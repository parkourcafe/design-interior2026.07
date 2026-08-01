import { semanticSha256 } from "../../application/change-handoff/canonical";
import { compareCodePoints } from "../../ordering";

/**
 * TypeScript mirror of the semantic content that
 * `projectceo_product_api.publish_project_baseline` rebuilds server-side and
 * compares byte-for-byte against the caller-supplied `descriptor.semanticHash`
 * (migration 20260717101000_projectceo_product_brain_operations.sql:2085-2127).
 *
 * The hash cannot be derived from the descriptor alone: the canonical object
 * also folds in `organizationId` and the *current rows* of
 * `projectceo_foundation.project_packages` for the referenced package ids.
 * Both are obtainable from the authenticated read envelope
 * (`projectceo_read_api.get_project_workspace_read` — `scope.organizationId`
 * and `data.packages`), so this needs no new migration and no new RPC.
 *
 * Two ordering rules differ from the read side and must not be taken on trust:
 * every id array is sorted by code point, and `packages` is ordered by
 * `id::text collate "C"` — whereas the read RPC returns packages ordered by
 * `stable_key`. Sorting here is therefore explicit, never inherited.
 */

export const BASELINE_SCHEMA_VERSION = "project-ceo-baseline/0.1" as const;

/** Max length enforced by `projectceo_product._sorted_unique_text_array`. */
const MAX_ID_LENGTH = 160;

export interface BaselinePackageRow {
  readonly id: string;
  readonly kind: string;
  readonly parentPackageId: string | null;
  readonly stableKey: string;
}

export interface BaselineSemanticContentInput {
  readonly organizationId: string;
  readonly projectId: string;
  readonly graphVersionId: string;
  readonly previousBaselineId: string | null;
  readonly packageIds: readonly string[];
  readonly sourceRevisionIds: readonly string[];
  readonly requirementRevisionIds: readonly string[];
  readonly assumptionRevisionIds: readonly string[];
  readonly decisionRevisionIds: readonly string[];
  readonly selectionRevisionIds: readonly string[];
  readonly approvalPackageIds: readonly string[];
  /** Current rows for `packageIds`; extra rows are ignored, missing rows throw. */
  readonly packages: readonly BaselinePackageRow[];
}

export class BaselineSemanticContentError extends Error {
  constructor(readonly field: string, readonly reason: string) {
    super(`${field}: ${reason}`);
    this.name = "BaselineSemanticContentError";
  }
}

/**
 * Mirrors `projectceo_product._sorted_unique_text_array`
 * (same migration:77-115). That function does **not** silently dedupe — it
 * raises on duplicates, on empty strings, on untrimmed values and on values
 * longer than 160 chars. Reproducing the rejection (rather than repairing the
 * input) keeps a caller from computing a hash the RPC would never accept.
 */
function sortedUniqueTextArray(
  values: readonly string[],
  field: string,
  allowEmpty = true,
): readonly string[] {
  if (!allowEmpty && values.length === 0) {
    throw new BaselineSemanticContentError(field, "must not be empty");
  }
  for (const value of values) {
    if (value === "" || value !== value.trim() || value.length > MAX_ID_LENGTH) {
      throw new BaselineSemanticContentError(field, "invalid identifier");
    }
  }
  if (new Set(values).size !== values.length) {
    throw new BaselineSemanticContentError(field, "duplicate identifier");
  }
  return [...values].sort(compareCodePoints);
}

/**
 * Rebuilds the exact object the RPC hashes. Key order is irrelevant —
 * `canonicalJson` sorts object keys by code point — but array order is load
 * bearing and is imposed here rather than assumed from the input.
 */
export function buildBaselineSemanticContent(
  input: BaselineSemanticContentInput,
): Readonly<Record<string, unknown>> {
  const packageIds = sortedUniqueTextArray(input.packageIds, "descriptor.packageIds", false);
  const requirementRevisionIds = sortedUniqueTextArray(
    input.requirementRevisionIds,
    "descriptor.requirementRevisionIds",
  );
  const assumptionRevisionIds = sortedUniqueTextArray(
    input.assumptionRevisionIds,
    "descriptor.assumptionRevisionIds",
  );
  const decisionRevisionIds = sortedUniqueTextArray(
    input.decisionRevisionIds,
    "descriptor.decisionRevisionIds",
  );
  const selectionRevisionIds = sortedUniqueTextArray(
    input.selectionRevisionIds,
    "descriptor.selectionRevisionIds",
  );
  // The RPC forbids an empty approvalPackageIds only when at least one
  // claim/requirement/assumption revision is being baselined.
  const requiresApproval = requirementRevisionIds.length
    + assumptionRevisionIds.length
    + decisionRevisionIds.length
    + selectionRevisionIds.length > 0;
  const approvalPackageIds = sortedUniqueTextArray(
    input.approvalPackageIds,
    "descriptor.approvalPackageIds",
    !requiresApproval,
  );

  const byId = new Map(input.packages.map((row) => [row.id, row]));
  const packages = packageIds.map((id) => {
    const row = byId.get(id);
    if (!row) {
      throw new BaselineSemanticContentError("descriptor.packageIds", `unknown package ${id}`);
    }
    // Only these four fields enter the hash — the read envelope also carries
    // `name` and `status`, which the RPC does not fold in.
    return {
      id: row.id,
      kind: row.kind,
      parentPackageId: row.parentPackageId,
      stableKey: row.stableKey,
    };
  });
  // RPC orders packages by `pp.id::text collate "C"`, not by stableKey.
  packages.sort((left, right) => compareCodePoints(left.id, right.id));

  return {
    approvalPackageIds,
    assumptionRevisionIds,
    decisionRevisionIds,
    graphVersionId: input.graphVersionId,
    organizationId: input.organizationId,
    packageIds,
    packages,
    previousBaselineId: input.previousBaselineId,
    projectId: input.projectId,
    requirementRevisionIds,
    schemaVersion: BASELINE_SCHEMA_VERSION,
    selectionRevisionIds,
    sourceRevisionIds: sortedUniqueTextArray(
      input.sourceRevisionIds,
      "descriptor.sourceRevisionIds",
    ),
  };
}

/** SHA-256 the RPC will accept for this baseline, or throw if the input cannot produce one. */
export function computeBaselineSemanticHash(
  input: BaselineSemanticContentInput,
): `sha256:${string}` {
  return semanticSha256(buildBaselineSemanticContent(input));
}
