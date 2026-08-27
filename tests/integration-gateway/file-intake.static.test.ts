import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("RemHaOS File Intake PR3 boundary", () => {
  const migration = read("supabase/migrations/20260826023906_remhaos_file_intake_hardening.sql");

  it("keeps quarantine state private and event history append-only", () => {
    expect(migration).toContain("create table remhaos_integration.file_intakes");
    expect(migration).toContain("create table remhaos_integration.file_intake_events");
    expect(migration).toContain("file_intake_events_append_only");
    expect(migration).toContain("status = 'published_internal_copy'");
    expect(migration).toContain("grant execute on function remhaos_integration_api.complete_file_intake_scan");
    expect(read("supabase/migrations/20260826056000_remhaos_file_intake_publish_replay.sql")).toContain(
      "published_internal_copy",
    );
  });

  it("uses request-bound routes and does not fetch or create public URLs", () => {
    const routes = [
      "app/api/projects/[projectId]/file-intakes/route.ts",
      "app/api/projects/[projectId]/file-intakes/[intakeId]/review/route.ts",
      "app/api/projects/[projectId]/file-intakes/[intakeId]/publish/route.ts",
      "app/api/projects/[projectId]/file-intakes/[intakeId]/download/route.ts",
    ].map(read).join("\n");
    expect(routes).not.toMatch(/createAdminClient|\bfetch\s*\(/);
    expect(routes).toContain("createProjectCeoRequestContext");
    expect(routes).toContain("assertFileIntakeMutation");
    expect(read("lib/integration-gateway/file-intake/storage.ts")).toContain("createSignedUrl");
    expect(read("app/api/projects/[projectId]/file-intakes/[intakeId]/review/route.ts")).toContain(
      "parseIntegrationJson(request)",
    );
    expect(read("app/api/projects/[projectId]/file-intakes/[intakeId]/review/route.ts")).toContain(
      "}).strict();",
    );
    const uploadRoute = read("app/api/projects/[projectId]/file-intakes/route.ts");
    const postRoute = uploadRoute.slice(uploadRoute.indexOf("export async function POST"));
    expect(postRoute).toContain("assertFileIntakeRequestSize(request)");
    expect(postRoute).toContain("boundedFileIntakeRequest(request).formData()");
    expect(postRoute.indexOf("createProjectCeoRequestContext()"))
      .toBeLessThan(postRoute.indexOf(".formData()"));
  });

  it("keeps the PR3 feature flag disabled by default", () => {
    expect(read(".env.example")).toContain("REMHAOS_FILE_INTAKE_ENABLED=false");
  });
});
