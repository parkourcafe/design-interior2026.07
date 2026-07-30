import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REQUEST_BOUND_FILES = [
  "app/api/projectceo/commands/route.ts",
  "app/api/projectceo/portfolio/route.ts",
  "app/api/projectceo/projects/[projectId]/route.ts",
  "lib/project-intelligence/delivery/projectceo/command-contract.ts",
  "lib/project-intelligence/delivery/projectceo/command-service.ts",
  "lib/project-intelligence/delivery/projectceo/live-read-port.ts",
  "lib/project-intelligence/delivery/projectceo/request-context.ts",
  "lib/project-intelligence/delivery/projectceo/server-port.ts",
] as const;

function read(files: readonly string[]): string {
  return files.map((file) => readFileSync(resolve(process.cwd(), file), "utf8")).join("\n");
}

describe("ProjectCEO request-bound static boundary", () => {
  const source = read(REQUEST_BOUND_FILES);
  const commandService = read([
    "lib/project-intelligence/delivery/projectceo/command-service.ts",
  ]);
  const fixtureRoute = read(["app/projectceo-qa/[role]/page.tsx"]);
  const commandClient = read(["components/projectceo/command-client.tsx"]);
  const workspace = read(["components/projectceo/project-workspace.tsx"]);

  it("does not import a service-role/admin client or query private tables directly", () => {
    expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|createAdminClient|adminClient/i);
    expect(source).not.toMatch(/\.from\s*\(\s*["'`]/);
    expect(source).not.toMatch(/projectceo_(foundation|brain|m4)\.[a-z_]+/i);
  });

  it("keeps worker-only M4 operations out of the human command service", () => {
    expect(commandService).not.toContain("ProjectCeoM4WorkerPostgresAdapter");
    expect(commandService).not.toContain("calculateChangeImpact(");
    expect(commandService).not.toContain("buildConstructionHandover(");
  });

  it("guards the local Kora fixture and fails closed in production", () => {
    expect(fixtureRoute).toContain('process.env.NODE_ENV === "production"');
    expect(fixtureRoute).toContain("notFound()");
    expect(source).toContain("projectceo_fixture_mode_forbidden_in_production");
    expect(source).not.toContain("PROJECTCEO_DEMO_ROLE");
  });

  it("persists one command id across failed retries and rotates it only after completion", () => {
    expect(commandClient).toContain("commandIdentity.current.commandId");
    expect(commandClient).toMatch(/response\.status !== ["']completed["'][\s\S]*setState\(["']error["']\)/);
    expect(commandClient).toMatch(/commandIdentity\.current = \{ fingerprint, commandId: crypto\.randomUUID\(\) \};[\s\S]*router\.refresh\(\)/);
  });

  it("binds the owner guest-revoke control to the server-derived operation state", () => {
    expect(workspace).toContain(
      'disabled={view.operations.revoke_guest_grant.status !== "available"}',
    );
  });
});
