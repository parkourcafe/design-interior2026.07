import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = "supabase/migrations/20260802090000_projectceo_m2_client_review_m3_handoff.sql";
const migration = () => readFileSync(path, "utf8");

describe("Cycle 6 additive persisted client review and M3 handoff migration", () => {
  it("is additive, transactional and extends rather than rewrites the M2 ledger", () => {
    const sql = migration();
    expect(sql).toMatch(/^begin;/i);
    expect(sql).toMatch(/commit;\s*$/i);
    expect(sql).toMatch(/m2_client_submission/);
    expect(sql).toMatch(/m2_client_review/);
    expect(sql).toMatch(/m2_m3_handoff/);
    expect(sql).not.toMatch(/create\s+or\s+replace\s+function\s+projectceo_read_api\.get_project_workspace_read_v5/i);
  });

  it("adds three dedicated authenticated human commands with server-derived authority", () => {
    const sql = migration();
    for (const operation of [
      "submit_m2_client_review",
      "review_m2_client_submission",
      "publish_m2_m3_handoff",
    ]) {
      expect(sql).toContain(`projectceo_product_api.${operation}`);
    }
    expect(sql).toMatch(/auth\.uid\s*\(\s*\)/i);
    expect(sql).toMatch(/_authorize_package_human/i);
    expect(sql).toMatch(/client_approver/i);
    expect(sql).toMatch(/owner_lead[^;]*architect|architect[^;]*owner_lead/i);
    expect(sql).toMatch(/submitted_by_actor_user_id[^;]*(?:<>|is distinct from)[^;]*actor_user_id/i);
    expect(sql).not.toMatch(/service_role[^;]*grant\s+execute/is);
  });

  it("persists exact immutable snapshots and derives M3 only from the approved commit", () => {
    const sql = migration();
    expect(sql).toMatch(/preferred[^]*value_engineered[^]*premium/i);
    expect(sql).toMatch(/layoutRevisionId/i);
    expect(sql).toMatch(/selectionRevisionIds/i);
    expect(sql).toMatch(/staleSelectionRevisionIds/i);
    expect(sql).toMatch(/missingPriceSelectionRevisionIds/i);
    expect(sql).toMatch(/approved_commit/i);
    expect(sql).toMatch(/chosenVariant/i);
    expect(sql).toMatch(/append.only|immutable|prevent_m2_workspace_revision_mutation/i);
    expect(sql).toMatch(/idempotency/i);
    expect(sql).toMatch(/expected_state_revision/i);
    expect(sql).toMatch(/expected_revision_id/i);
  });

  it("rebuilds every submitted variant from authoritative selection, approval and price provenance", () => {
    const sql = migration();
    expect(sql).toMatch(/project_intelligence\.graph_node_revisions/i);
    expect(sql).toMatch(/entity_kind\s*=\s*'selection'|node_type\s*=\s*'selection'/i);
    expect(sql).toMatch(/projectceo_product\.approval_packages/i);
    expect(sql).toMatch(/projectceo_product\.approval_package_items/i);
    expect(sql).toMatch(/to_status\s*=\s*'approved'|status\s*=\s*'approved'/i);
    expect(sql).toMatch(/projectceo_product\.price_observations/i);
    expect(sql).toMatch(/revision_evidence_refs|evidence_refs/i);
    expect(sql).toMatch(/amountRub[^]*sum\s*\(|sum\s*\([^]*amountRub/i);
    expect(sql).toMatch(/APPROVAL_PACKAGE_(?:REQUIRED|INVALID|MISMATCH)/i);
    expect(sql).toMatch(/DESIGN_INTENT_(?:REQUIRED|INVALID|MISMATCH)/i);
    expect(sql).toMatch(/SELECTION_(?:REVISION_)?(?:REQUIRED|INVALID|MISMATCH)/i);
    expect(sql).toMatch(/PRICE_(?:PROVENANCE_)?(?:REQUIRED|INVALID|MISMATCH)/i);
  });

  it("uses the authoritative approved-commit append path atomically with client approval", () => {
    const sql = migration();
    const reviewBody = sql.match(
      /create function projectceo_product_api\.review_m2_client_submission\([^]*?end \$function\$;/i,
    )?.[0];
    expect(reviewBody).toBeDefined();
    expect(reviewBody).toMatch(/projectceo_product_api\.append_m2_workspace_revision\(/i);
    expect(reviewBody).toMatch(/'approved_commit'/i);
    expect(reviewBody).toMatch(/append_m2_approved_commit_revision/i);
    expect(reviewBody).toMatch(/m2_approved_commit_revision_appended/i);
    expect(reviewBody).not.toMatch(/insert\s+into\s+projectceo_product\.m2_workspace_revisions/i);
  });

  it("adds read v6 over v5 with role-scoped review and M3 projections", () => {
    const sql = migration();
    expect(sql).toContain("projectceo_read_api.get_project_workspace_read_v6");
    expect(sql).toContain("projectceo_read_api.get_project_workspace_read_v5");
    expect(sql).toMatch(/m2ClientReviewSubmissions/);
    expect(sql).toMatch(/m2ClientReviews/);
    expect(sql).toMatch(/m2M3Handoffs/);
    expect(sql).toMatch(/client_approver/i);
    expect(sql).toMatch(/owner_lead[^]*architect/i);
    expect(sql).toMatch(/builder[^]*(?:'\[\]'::jsonb|jsonb_build_array)/i);
    expect(sql).toMatch(/guest[^]*(?:'\[\]'::jsonb|jsonb_build_array)/i);
  });
});
