import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("RemHaOS Project Links PR2 boundary", () => {
  const migration = read(
    "supabase/migrations/20260826020840_remhaos_project_links.sql",
  );

  it("uses additive link tables and append-only revisions", () => {
    expect(migration).toContain("create table remhaos_integration.project_links");
    expect(migration).toContain("create table remhaos_integration.project_link_revisions");
    expect(migration).toContain("project_link_revisions_append_only");
    expect(migration).toContain("published_revision_no");
  });

  it("keeps URL creation free of server-side fetch and rejects secrets", () => {
    const route = read("app/api/projects/[projectId]/links/route.ts");
    const service = read("lib/integration-gateway/links/project-link-service.ts");
    const policy = read("lib/integration-gateway/core/url-policy.ts");

    expect(route).not.toMatch(/\bfetch\s*\(/);
    expect(service).not.toMatch(/\bfetch\s*\(/);
    expect(route).toContain("assertProjectLinksMutation");
    expect(read("app/api/projects/[projectId]/links/[linkId]/publish/route.ts")).toContain("assertProjectLinksMutation");
    expect(read("app/api/projects/[projectId]/links/[linkId]/revisions/route.ts")).toContain("assertProjectLinksMutation");
    expect(read("app/api/projects/[projectId]/links/[linkId]/archive/route.ts")).toContain("assertProjectLinksMutation");
    expect(policy).toContain("forbiddenQueryKeys");
    expect(policy).toContain("parsed.hash = \"\"");
  });

  it("bounds every mutation body before JSON parsing", () => {
    const routes = [
      "app/api/projects/[projectId]/links/route.ts",
      "app/api/projects/[projectId]/links/[linkId]/revisions/route.ts",
      "app/api/projects/[projectId]/links/[linkId]/publish/route.ts",
      "app/api/projects/[projectId]/links/[linkId]/archive/route.ts",
    ];
    for (const route of routes) {
      const source = read(route);
      expect(source).toContain("parseIntegrationJson(request, projectLinksJsonMaxBytes)");
      expect(source).not.toContain("request.json()");
      expect(source).toContain("projectLinksRequestErrorResponse");
    }
  });

  it("keeps the PR2 rollout flag disabled by default", () => {
    expect(read(".env.example")).toContain("REMHAOS_PROJECT_LINKS_ENABLED=false");
  });
});
