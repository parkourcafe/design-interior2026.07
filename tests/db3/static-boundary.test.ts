import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("Foundation static security boundary", () => {
  it("keeps application adapters off private tables and legacy admin client", () => {
    const files = [
      "lib/project-intelligence/adapters/postgres/foundation.ts",
      "lib/project-intelligence/adapters/postgres/db2.ts",
      "lib/project-intelligence/delivery/server/foundation-service.ts",
    ];
    const source = files.map(read).join("\n");

    expect(source).not.toContain('schema("project_intelligence")');
    expect(source).not.toContain("createAdminClient");
    expect(source).not.toContain('from "@/lib/supabase/admin"');
    expect(source).not.toMatch(/\.from\(["'](?:organizations|graph_nodes|sources)/);
  });

  it("materializes exact protected storage and token rules additively", () => {
    const migration = read(
      "supabase/migrations/20260717091000_projectceo_foundation_ingestion_read.sql",
    );
    expect(migration).toContain("project-intelligence/ru/");
    expect(migration).toContain("RAW_CAD_OR_ARCHIVE_REQUIRES_PREPROCESSING");
    expect(migration).toContain("version_evidence_scope_closure");
    expect(migration).toContain("revoke all on all functions in schema projectceo_api");
  });

  it("does not grant runtime roles direct Foundation table access", () => {
    const migrations = [
      "supabase/migrations/20260717090000_projectceo_foundation_access.sql",
      "supabase/migrations/20260717091000_projectceo_foundation_ingestion_read.sql",
    ]
      .map(read)
      .join("\n");
    expect(migrations).not.toMatch(
      /grant\s+(?:select|insert|update|delete|all)[\s\S]{0,120}projectceo_foundation\.[\w"]+[\s\S]{0,80}to\s+(?:anon|authenticated|service_role)/i,
    );
  });
});
