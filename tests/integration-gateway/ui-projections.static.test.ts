import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("RemHaOS Integration Gateway PR5 UI boundary", () => {
  it("keeps settings and project controls request-bound and idempotent", () => {
    const settings = read("components/integration-gateway/integrations-settings-panel.tsx");
    const connections = read("components/integration-gateway/project-connections-panel.tsx");
    const inbox = read("components/integration-gateway/project-inbox-panel.tsx");

    expect(settings).toContain('"use client"');
    expect(settings).toContain("/api/integrations/");
    expect(settings).toContain("/api/integrations/${connectionId}/disconnect");
    expect(settings).not.toContain("/api/integrations/connections/${connectionId}/disconnect");
    expect(settings).toContain("ru.projectConnections.unknownProvider");
    expect(connections).toContain("ru.projectConnections.unknownProvider");
    expect(settings).toContain("Idempotency-Key");
    expect(settings).toContain("safeReasonLabel");
    expect(settings).not.toMatch(/createAdminClient|service_role|access_token|refresh_token/i);
    expect(connections).toContain("/api/projects/${projectId}/connections");
    expect(connections).toContain("/unbind");
    expect(connections).toContain("/sync");
    expect(connections).toContain("Idempotency-Key");
    expect(inbox).toContain("/imports/${candidate.candidateId}/review");
    expect(inbox).toContain("/inbox/review");
    expect(inbox).toContain("/file-intakes/${file.intakeId}/review");
    expect(inbox).toContain("/file-intakes/${file.intakeId}/publish");
    expect(inbox).toContain("Idempotency-Key");
  });

  it("keeps team read separate from integration management", () => {
    const migration = read(
      "supabase/migrations/20260826050000_remhaos_integration_ui_read_projections.sql",
    );
    expect(migration).toContain("list_team_project_connections");
    expect(migration).toContain("'review_source'");
    expect(migration).toContain("to authenticated");
    expect(migration).toContain("revoke all on function");
  });

  it("keeps all PR5 visible copy in the Russian dictionary", () => {
    const copy = read("lib/i18n/ru.ts");
    expect(copy).toContain("projectBinding");
    expect(copy).toContain("reviewReasonRequired");
    expect(copy).toContain("notConnected");
    expect(copy).toContain("statuses:");
  });

  it("keeps organization provider settings owner-only at the route boundary", () => {
    const page = read("app/dashboard/setup/integrations/page.tsx");
    const providersRoute = read("app/api/integrations/providers/route.ts");
    const connectIntentRoute = read("app/api/integrations/[provider]/connect-intent/route.ts");
    const access = read("lib/integration-gateway/registry/access.ts");

    expect(page).toContain("requireIntegrationOwner");
    expect(page).toContain("notFound();");
    expect(providersRoute).toContain("requireIntegrationOwner");
    expect(connectIntentRoute).toContain("requireIntegrationOwner");
    expect(access).toContain('portfolio.data.actor.role !== "owner"');
    expect(access).not.toMatch(/service_role|access_token|refresh_token|metadata/i);
  });
});
