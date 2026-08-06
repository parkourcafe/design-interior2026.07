import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const migrationPath = resolve(
  repoRoot,
  "supabase/migrations/20260802070000_projectceo_m2_approved_commits.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

describe("M2 approved commit additive persistence migration", () => {
  it("exists after the package-scope read fix and is transactional", () => {
    expect(migrationPath).toMatch(/20260802070000_/);
    expect(migration).toMatch(/^--[^]*\nbegin;/i);
    expect(migration.trimEnd()).toMatch(/commit;$/i);
  });

  it("extends the immutable M2 ledger with approved commits without replacing it", () => {
    expect(migration).not.toMatch(/drop\s+table[^;]*m2_workspace_revisions/i);
    expect(migration).not.toMatch(/truncate\s+[^;]*m2_workspace_revisions/i);
    expect(migration).toMatch(/entity_kind[^;]*approved_commit/i);
    expect(migration).toMatch(/status[^;]*approved/i);
    expect(migration).toContain("projectceo_product.m2_workspace_revisions");
    expect(migration).toContain("projectceo_product_api.append_m2_workspace_revision");
  });

  it("keeps approved commits request-bound to a human package capability", () => {
    expect(migration).toContain("projectceo_foundation._authorize_package_human");
    expect(migration).toMatch(/approved_commit[^]*review_selection/i);
    expect(migration).not.toMatch(/auth\.uid\s*\(\s*\)/i);
    expect(migration).not.toMatch(/service_role[^]*_authorize_package_human/i);
  });

  it("accepts only the exact approved snapshot identity and chosen layout reference", () => {
    for (const field of [
      "approvalPackageId",
      "roomId",
      "designIntentRevisionId",
      "chosenVariant",
      "approvedSelectionRevisionIds",
      "budget",
      "submittedAt",
      "reviewedAt",
      "submissionReason",
      "reviewReason",
    ]) {
      expect(migration).toContain(field);
    }
    for (const field of [
      "variantId",
      "role",
      "layoutDocumentId",
      "layoutVersionId",
      "semanticHash",
    ]) {
      expect(migration).toContain(field);
    }
    expect(migration).toMatch(/preferred[^]*value_engineered[^]*premium/i);
    expect(migration).toMatch(/sha256:\[0-9a-f\]\{64\}/i);
    expect(migration).toMatch(/jsonb_object_keys|payload\s*-\s*array\s*\[/i);
  });

  it("rejects dirty, stale or incomplete approved budgets", () => {
    for (const field of [
      "asOf",
      "staleAfterDays",
      "amountRub",
      "staleSelectionRevisionIds",
      "missingPriceSelectionRevisionIds",
    ]) {
      expect(migration).toContain(field);
    }
    expect(migration).toMatch(/jsonb_array_length[^;]*staleSelectionRevisionIds/i);
    expect(migration).toMatch(/jsonb_array_length[^;]*missingPriceSelectionRevisionIds/i);
    expect(migration).toMatch(/amountRub[^]*(9007199254740991|safe)/i);
    expect(migration).toMatch(/reviewedAt[^;]*<[^;]*submittedAt/i);
  });

  it("records the dedicated command operation and append-only audit event", () => {
    expect(migration).toContain("append_m2_approved_commit_revision");
    expect(migration).toContain("m2_approved_commit_revision_appended");
    expect(migration).toMatch(/command_records_operation_check/i);
    expect(migration).toMatch(/audit_events_event_type_check/i);
    expect(migration).toContain("projectceo_product.audit_events");
  });

  it("adds read v4 on top of v3 and exposes only latest approved commits", () => {
    expect(migration).toContain("projectceo_read_api.get_project_workspace_read_v4");
    expect(migration).toContain("projectceo_read_api.get_project_workspace_read_v3");
    expect(migration).not.toMatch(/create\s+or\s+replace\s+function\s+projectceo_read_api\.get_project_workspace_read_v3/i);
    expect(migration).toContain("m2ApprovedCommits");
    expect(migration).toMatch(/distinct\s+on\s*\([^)]*entity_kind[^)]*entity_id/i);
    expect(migration).toMatch(/entity_kind\s*=\s*'approved_commit'/i);
    expect(migration).toMatch(/status\s*=\s*'approved'/i);
    expect(migration).toMatch(/package_id\s*=\s*get_project_workspace_read_v4\.package_id/i);
  });

  it("keeps project-wide reads when the optional package filter is null", () => {
    expect(migration).toMatch(
      /get_project_workspace_read_v4\.package_id\s+is\s+null\s+or\s+(?:revision\.)?package_id\s*=\s*get_project_workspace_read_v4\.package_id/i,
    );
  });

  it("redacts the approved budget amount from non-financial project roles", () => {
    expect(migration).toMatch(/v_financial\s*:=\s*v_role\s+in\s*\([^)]*owner_lead[^)]*architect[^)]*\)/i);
    expect(migration).toMatch(
      /case\s+when\s+v_financial\s+then\s+revision\.payload\s+else\s+revision\.payload\s*#-\s*'\{budget,amountRub\}'/i,
    );
  });

  it("binds approval and selection lineage to the authorized project package", () => {
    expect(migration).toMatch(
      /from\s+projectceo_product\.approval_packages\s+approval[^]*approval\.organization_id\s*=\s*v_context\.organization_id[^]*approval\.project_id\s*=\s*project_id[^]*approval\.package_id\s*=\s*package_id[^]*approval\.approval_package_id\s*=\s*payload\s*->>\s*'approvalPackageId'/i,
    );
    expect(migration).toMatch(
      /from\s+projectceo_product\.approval_package_items\s+item[^]*item\.approval_package_id\s*=\s*payload\s*->>\s*'approvalPackageId'[^]*item\.target_kind\s*=\s*'selection_revision'/i,
    );
  });

  it("requires null expectedRevisionId for the first immutable commit revision", () => {
    expect(migration).toMatch(
      /if\s+v_current\s+is\s+null\s+then[^]*expected_revision_id\s+is\s+not\s+null[^]*stale_state/i,
    );
  });

  it("requires the authoritative latest approval event to be approved", () => {
    expect(migration).toMatch(
      /entity_kind\s*=\s*'approved_commit'[^]*approval_package_events[^]*to_status\s*=\s*'approved'[^]*sequence_no\s*=\s*\([^]*max\s*\([^)]*sequence_no[^]*\)/i,
    );
    expect(migration).toMatch(/APPROVED_COMMIT_APPROVAL_REQUIRED/i);
  });

  it("binds reviewedAt and reviewReason to the authoritative latest approved review event", () => {
    expect(migration).toMatch(
      /select\s+event\.occurred_at\s*,\s*event\.reason\s*,\s*event\.actor_user_id\s+into\s+v_authoritative_reviewed_at\s*,\s*v_authoritative_review_reason\s*,\s*v_authoritative_reviewer_user_id[^]*from\s+projectceo_product\.approval_package_events\s+event[^]*event\.to_status\s*=\s*'approved'[^]*event\.sequence_no\s*=\s*\([^]*max\s*\([^)]*sequence_no[^]*\)/i,
    );
    expect(migration).toMatch(
      /\(payload\s*->>\s*'reviewedAt'\)::timestamptz\s+is\s+distinct\s+from\s+v_authoritative_reviewed_at/i,
    );
    expect(migration).toMatch(
      /payload\s*->>\s*'reviewReason'\s+is\s+distinct\s+from\s+v_authoritative_review_reason/i,
    );
  });

  it("binds submittedAt to the authoritative sequence-2 submission event", () => {
    expect(migration).toMatch(
      /select\s+event\.occurred_at\s+into\s+v_authoritative_submitted_at[^]*from\s+projectceo_product\.approval_package_events\s+event[^]*event\.approval_package_id\s*=\s*payload\s*->>\s*'approvalPackageId'[^]*event\.sequence_no\s*=\s*2[^]*event\.to_status\s*=\s*'submitted'/i,
    );
    expect(migration).toMatch(
      /\(payload\s*->>\s*'submittedAt'\)::timestamptz\s+is\s+distinct\s+from\s+v_authoritative_submitted_at/i,
    );
  });

  it("requires the request-bound caller to be the authoritative reviewer", () => {
    expect(migration).toMatch(
      /v_context\.actor_user_id\s+is\s+distinct\s+from\s+v_authoritative_reviewer_user_id/i,
    );
    expect(migration).toMatch(/APPROVED_COMMIT_REVIEWER_MISMATCH/i);
  });

  it("classifies submissionReason as a committer-supplied note, not event provenance", () => {
    expect(migration).toMatch(
      /submissionReason[^\n]*(?:committer-supplied|committer supplied)[^\n]*note/i,
    );
    expect(migration).toMatch(
      /sequence(?:_no)?\s*2[^\n]*(?:has|contains)[^\n]*no\s+reason/i,
    );
  });

  it("accepts only finite RFC3339 timestamps with an explicit offset", () => {
    for (const timestampPath of [
      "payload->>'submittedAt'",
      "payload->>'reviewedAt'",
      "payload#>>'{budget,asOf}'",
    ]) {
      expect(migration).toContain(timestampPath);
    }
    expect(migration).toMatch(
      /\^\\d\{4\}-\\d\{2\}-\\d\{2\}T\\d\{2\}:\\d\{2\}:\\d\{2\}(?:\\\.\\d\+)?(?:Z|\[\+\-\]\\d\{2\}:\\d\{2\})\$/,
    );
    expect(migration).toMatch(/isfinite|'-infinity'|'infinity'/i);
  });

  it("preserves the private-table RLS boundary and only exposes authenticated RPCs", () => {
    expect(migration).not.toMatch(/disable\s+row\s+level\s+security/i);
    expect(migration).not.toMatch(/grant\s+(select|insert|update|delete|all)[^;]*m2_workspace_revisions/i);
    expect(migration).toMatch(/revoke\s+all\s+on\s+function[^;]*append_m2_workspace_revision[^;]*from\s+public[^;]*anon[^;]*authenticated[^;]*service_role/is);
    expect(migration).toMatch(/grant\s+execute\s+on\s+function[^;]*append_m2_workspace_revision[^;]*to\s+authenticated/is);
    expect(migration).toMatch(/security\s+definer/i);
    expect(migration).toMatch(/set\s+search_path\s*=\s*''/i);
  });
});
