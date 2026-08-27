import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("RemHaOS Integration Gateway PR1 static boundary", () => {
  const foundationMigration = read(
    "supabase/migrations/20260826010550_remhaos_integration_registry_foundation.sql",
  );
  const operationsMigration = read(
    "supabase/migrations/20260826010601_remhaos_integration_registry_operations.sql",
  );

  it("exposes only the request-bound API schema through Supabase config", () => {
    const config = read("supabase/config.toml");

    expect(config).toContain('"remhaos_integration_api"');
    expect(config).not.toMatch(
      /schemas\s*=\s*\[[^\]]*"remhaos_integration"/s,
    );
  });

  it("keeps integration rollout flags default-off", () => {
    const envExample = read(".env.example");

    expect(envExample).toContain("REMHAOS_INTEGRATIONS_ENABLED=false");
    expect(envExample).toContain("REMHAOS_PROJECT_LINKS_ENABLED=false");
    expect(envExample).toContain("REMHAOS_GOOGLE_DRIVE_ENABLED=false");
  });

  it("keeps PR1 generic and provider-adapter free", () => {
    const root = process.cwd();

    expect(
      existsSync(resolve(root, "lib/integration-gateway/connectors/google-drive")),
    ).toBe(false);
    expect(
      existsSync(resolve(root, "app/api/integrations/google-drive")),
    ).toBe(false);
    expect(operationsMigration).not.toContain("googleapis");
    expect(operationsMigration).not.toContain("https://www.googleapis.com");
  });

  it("adds only the integration API schema to the shared RPC adapter", () => {
    const rpc = read("lib/project-intelligence/adapters/postgres/rpc.ts");

    expect(rpc).toContain('"remhaos_integration_api"');
    expect(rpc).not.toContain('"remhaos_integration"');
  });

  it("keeps private integration tables owner-only under forced RLS", () => {
    const migrations = `${foundationMigration}\n${operationsMigration}`;

    expect(foundationMigration).toContain(
      "create schema remhaos_integration authorization pi_table_owner",
    );
    expect(foundationMigration).toContain(
      "create schema remhaos_integration_api authorization pi_table_owner",
    );
    expect(migrations).toContain("force row level security");
    expect(migrations).toContain(
      "for all to pi_table_owner using (true) with check (true)",
    );
    expect(migrations).not.toMatch(
      /grant\s+(?:select|insert|update|delete|all)[\s\S]{0,160}remhaos_integration\.[\w"]+[\s\S]{0,100}to\s+(?:anon|authenticated|service_role|pi_human_executor|pi_worker_executor)/i,
    );
  });

  it("does not grant integration RPC execution to anon or public", () => {
    const migrations = `${foundationMigration}\n${operationsMigration}`;

    expect(migrations).toContain(
      "revoke all on all functions in schema remhaos_integration_api",
    );
    expect(migrations).not.toMatch(
      /grant\s+execute\s+on\s+function[\s\S]{0,1200}remhaos_integration_api[\s\S]{0,1200}\s+to\s+(?:anon|public)\b/i,
    );
  });

  it("stores worker job idempotency as a hash, not the caller key", () => {
    expect(operationsMigration).toContain(
      "idempotency_key text not null\n    check (idempotency_key ~ '^[a-f0-9]{64}$')",
    );
    expect(operationsMigration).toContain("v_job_key := encode(v_key_digest, 'hex')");
  });
});
