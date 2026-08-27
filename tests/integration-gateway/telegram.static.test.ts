import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Telegram staging boundary", () => {
  it("documents the server-only webhook secret without enabling the bridge", () => {
    const envExample = read(".env.example");
    expect(envExample).toContain("REMHAOS_TELEGRAM_BRIDGE_ENABLED=false");
    expect(envExample).toContain("TELEGRAM_WEBHOOK_SECRET=your-telegram-webhook-secret");
    expect(envExample).toContain("TELEGRAM_BOT_TOKEN=your-telegram-bot-token");
  });

  it("keeps Telegram state private and makes rebinding auditable", () => {
    const migration = read("supabase/migrations/20260826030233_remhaos_telegram_staging.sql");
    const guardMigration = read("supabase/migrations/20260826057000_remhaos_telegram_quarantine_key_guard.sql");
    expect(migration).toContain("create table remhaos_integration.telegram_bindings");
    expect(migration).toContain("create table remhaos_integration.telegram_attachments");
    expect(migration).toContain("create table remhaos_integration.telegram_ingestion_jobs");
    expect(migration).toContain("migrated_to_binding_id");
    expect(migration).toContain("telegram_chat_migrated");
    expect(migration).toContain("official_artifact_mutated");
    expect(migration).toContain("to pi_worker_executor");
    expect(migration).not.toContain("insert into project_intelligence.sources");
    expect(guardMigration).toContain("telegram_attachment_quarantine_key_guard");
    expect(guardMigration).toContain("CANONICAL_KEY_REQUIRED");
    expect(guardMigration).toContain("encode(new.checksum, 'hex')");
  });

  it("does not persist the raw webhook payload at the HTTP boundary", () => {
    const route = read("app/api/integrations/telegram/webhook/route.ts");
    const worker = read("lib/integration-gateway/telegram/worker.ts");
    expect(route).toContain("TELEGRAM_WEBHOOK_SECRET");
    expect(route).toContain("x-telegram-bot-api-secret-token");
    expect(route).toContain("worker_unavailable");
    expect(route).toContain("status: 202");
    expect(route).toContain("createTelegramWebhookIngress");
    expect(route).toContain("readTelegramBody(request)");
    expect(route).not.toContain("request.text()");
    expect(route).not.toMatch(/from ["']@\/lib\/supabase\/admin/);
    expect(route).not.toMatch(/createClient|service_role|fetch\(/i);
    expect(route).not.toContain("JSON.stringify(parseTelegramBody");
    expect(worker).toContain("ingest_telegram_update");
    expect(worker).toContain("quarantineObjectKey");
    expect(worker).not.toMatch(/console\.(log|error|warn)/);
  });
});
