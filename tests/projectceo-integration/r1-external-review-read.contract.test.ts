import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(
  __dirname,
  "../../supabase/migrations/20260920150000_r1_external_review_read_contract.sql",
), "utf8");

describe("R1 external review read contract", () => {
  it("keeps review evidence private, scoped and non-releasing", () => {
    expect(sql).toContain("get_external_review");
    expect(sql).toContain("get_project_workspace_read_v5(p_project_id, null)");
    expect(sql).toContain("assigned_client_user_id is distinct from v_actor");
    expect(sql).toContain("'ineligible_file_review'");
    expect(sql).toContain("'not_evaluated'");
    expect(sql).toContain("'safeExactRefs'");
    expect(sql).not.toMatch(/private_storage_locator|original_filename|semantic_snapshot/);
    expect(sql).not.toMatch(/grant\s+execute[^;]*service_role/i);
  });
});
