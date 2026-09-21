import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(
  __dirname,
  "../../supabase/migrations/20260920160000_r1_external_review_subject_preview.sql",
), "utf8");

describe("R1 external review subject preview", () => {
  it("builds a bounded file-review subject without persisting or releasing it", () => {
    expect(sql).toContain("preview_external_review_subject");
    expect(sql).toContain("_authorize_package_human");
    expect(sql).toContain("'prepare_client_handoff'");
    expect(sql).toContain("resolve_r1_external_release_attachment_ref");
    expect(sql).toContain("DUPLICATE_EXTERNAL_REF");
    expect(sql).toContain("'ineligible_file_review'");
    expect(sql).toContain("'not_evaluated'");
    expect(sql).not.toMatch(/insert\s+into|update\s+|delete\s+from/i);
    expect(sql).not.toMatch(/grant\s+execute[^;]*service_role/i);
  });
});
