import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("RemHaOS Integration Gateway HTTP boundary", () => {
  const routes = [
    "app/api/integrations/providers/route.ts",
    "app/api/integrations/connections/route.ts",
    "app/api/integrations/[provider]/connect-intent/route.ts",
    "app/api/integrations/[provider]/callback/route.ts",
    "app/api/integrations/[provider]/oauth/callback/route.ts",
    "app/api/integrations/[provider]/webhook/route.ts",
    "app/api/integrations/connections/[connectionId]/route.ts",
    "app/api/integrations/[provider]/disconnect/route.ts",
    "app/api/projects/[projectId]/connections/route.ts",
    "app/api/projects/[projectId]/connections/unbind/route.ts",
    "app/api/projects/[projectId]/connections/[connectionId]/bind/route.ts",
    "app/api/projects/[projectId]/connections/[connectionId]/unbind/route.ts",
    "app/api/projects/[projectId]/imports/route.ts",
    "app/api/projects/[projectId]/imports/review/route.ts",
    "app/api/projects/[projectId]/imports/[candidateId]/review/route.ts",
    "app/api/projects/[projectId]/inbox/review/route.ts",
  ];

  it("keeps the generic route family present and request-bound", () => {
    const source = routes.map((route) => {
      expect(existsSync(resolve(process.cwd(), route))).toBe(true);
      return read(route);
    }).join("\n");
    expect(source).toContain("createProjectCeoRequestContext");
    expect(source).not.toMatch(/createAdminClient|service_role|fetch\s*\(/i);
    expect(source).toContain("integrationGatewayEnabled");
    expect(existsSync(resolve(process.cwd(), "app/api/integrations/[connectionId]/disconnect/route.ts"))).toBe(false);
  });

  it("does not claim OAuth/import completion without provider transport", () => {
    const source = read("app/api/integrations/[provider]/connect-intent/route.ts");
    const settings = read("components/integration-gateway/integrations-settings-panel.tsx");
    const imports = read("app/api/projects/[projectId]/imports/route.ts");
    expect(source).toContain("oauthTransportNotConfigured");
    expect(source).toContain("}).strict();");
    expect(source).not.toContain("organizationId");
    expect(settings).toContain("body: JSON.stringify({\n          requestedScopes:");
    expect(imports).toContain("provider_worker_not_configured");
    expect(imports).toContain("}).strict();");
    expect(source).not.toMatch(/console\.(log|error|warn)/);
    expect(imports).not.toMatch(/console\.(log|error|warn)/);
    expect(read("app/api/integrations/[provider]/webhook/route.ts")).toContain(
      "consumeIntegrationWebhookBody(request)",
    );
    expect(read("app/api/integrations/[provider]/webhook/route.ts")).not.toContain(
      "parseIntegrationJson(request)",
    );
  });

  it("bounds JSON stream reads before parsing", () => {
    const http = read("lib/integration-gateway/registry/http.ts");
    expect(http).toContain("readBoundedIntegrationText");
    expect(http).not.toContain("await request.text()");
    expect(http).toContain('new TextDecoder("utf-8", { fatal: true })');
  });
});
