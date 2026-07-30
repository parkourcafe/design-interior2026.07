import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260718124958_projectceo_ap1_authenticated_reads.sql",
    import.meta.url,
  ),
  "utf8",
);
const adapter = readFileSync(
  new URL(
    "../../../lib/project-intelligence/adapters/postgres/authenticated-read.ts",
    import.meta.url,
  ),
  "utf8",
);

describe("AP1 authenticated read static boundary", () => {
  it("keeps one RPC-only schema and an explicit authenticated-only ACL", () => {
    expect(migration).toContain("create schema projectceo_read_api");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("grant usage on schema projectceo_read_api to authenticated");
    expect(migration).toContain("to authenticated;");
    expect(migration).not.toMatch(/grant\s+(select|insert|update|delete).*projectceo_/i);
  });

  it("does not accept caller-provided actor, organization, role or recipient", () => {
    const signatureStart = migration.indexOf(
      "create function projectceo_read_api.get_project_workspace_read",
    );
    const signature = migration.slice(
      signatureStart,
      migration.indexOf(")\nreturns jsonb", signatureStart),
    );
    expect(signature).toContain("project_id uuid");
    expect(signature).toContain("package_id uuid default null");
    expect(signature).not.toMatch(/actor|organization|role|recipient/i);
    expect(adapter).not.toMatch(/schema\(["']projectceo_(foundation|product|m4)["']\)/);
    expect(adapter).not.toMatch(/service[_-]?role/i);
  });

  it("makes recipient binding explicit and keeps protected filenames out", () => {
    expect(migration).toContain("distribution.recipient_user_id = v_actor_user_id");
    expect(migration).toContain("'distributionIds', 'recipient_bound'");
    expect(migration).not.toContain("original_filename");
    expect(migration).not.toContain("storage_object_path");
  });
});
