import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Google Drive staging boundary", () => {
  it("registers a default-off staging provider with minimal scope", () => {
    const migration = read("supabase/migrations/20260826034120_remhaos_google_drive_staging.sql");
    const envExample = read(".env.example");
    expect(migration).toContain("'https://www.googleapis.com/auth/drive.file'");
    expect(migration).toContain("'staging_only'");
    expect(migration).toContain("default_enabled\n)\nvalues");
    expect(migration).toContain("shared_drives_enabled boolean not null default false");
    expect(migration).toContain("create function remhaos_integration_api.create_oauth_intent");
    expect(migration).toContain("create_oauth_intent");
    expect(migration).not.toContain("auth/drive'");
    expect(envExample).toContain(
      "GOOGLE_DRIVE_REDIRECT_URI=https://your-staging-host.example/api/integrations/google_drive/oauth/callback",
    );
    expect(envExample).toContain("REMHAOS_SECRET_STORE_ADAPTER=fail_closed");
  });

  it("keeps provider credentials and raw IDs out of connector projections", () => {
    const connector = read("lib/integration-gateway/google-drive/connector.ts");
    expect(connector).toContain("GoogleDriveCredentialsRequiredError");
    expect(connector).toContain("REMHAOS_GOOGLE_DRIVE_ENABLED");
    expect(connector).not.toMatch(/console\.(log|error|warn)/);
    expect(connector).not.toMatch(/access[_-]?token|refresh[_-]?token|client_secret/i);
  });

  it("defines hash-only channel lifecycle and notification dedupe operations", () => {
    const migration = read("supabase/migrations/20260826042000_remhaos_google_drive_webhook_operations.sql");
    expect(migration).toContain("create table remhaos_integration.google_drive_webhook_notifications");
    expect(migration).toContain("create function remhaos_integration_api.create_google_drive_webhook_channel");
    expect(migration).toContain("create function remhaos_integration_api.stop_google_drive_webhook_channel");
    expect(migration).toContain("create function remhaos_integration_api.record_google_drive_notification");
    expect(migration).toContain("create function remhaos_integration_api.resolve_google_drive_webhook_channel");
    expect(migration).toContain("google_drive_stop_channels_after_disconnect");
    expect(migration).toContain("notification_id_hash");
    expect(migration).not.toMatch(/raw[_-]?provider|provider[_-]?body|access[_-]?token|refresh[_-]?token/i);
  });

  it("keeps Picker selection and credential lookup server-side", () => {
    const picker = read("lib/integration-gateway/google-drive/picker.ts");
    const runtime = read("lib/integration-gateway/google-drive/runtime.ts");
    const migration = read("supabase/migrations/20260827010000_remhaos_integration_gateway_transport.sql");
    expect(picker).toContain('z.literal("cancelled")');
    expect(picker).toContain("selectedGoogleDriveObject");
    expect(runtime).toContain("createGoogleDriveSelectionStore");
    expect(migration).toContain("get_integration_credential_ref");
    expect(migration).toContain("claim_selected_google_drive_import_jobs");
    expect(migration).toContain("cancel_integration_jobs_on_disconnect");
    expect(migration).toContain("request_selected_google_drive_import");
    expect(migration).not.toMatch(/grant execute[\s\S]{0,400}to authenticated[\s\S]{0,400}get_integration_credential_ref/i);
  });

  it("preserves evidence and supersedes open candidates on revision change", () => {
    const migration = read("supabase/migrations/20260826043000_remhaos_external_revision_supersession.sql");
    expect(migration).toContain("create or replace function remhaos_integration_api.create_import_candidate");
    expect(migration).toContain("status in ('candidate', 'reviewing')");
    expect(migration).toContain("set status = 'superseded'");
    expect(migration).toContain("for update");
    expect(migration).not.toMatch(/delete\s+from\s+remhaos_integration\.import_candidates/i);
  });

  it("fences Drive work after credential revocation", () => {
    const migration = read("supabase/migrations/20260826044000_remhaos_google_drive_reauth_transition.sql");
    expect(migration).toContain("create function remhaos_integration_api.mark_google_drive_reauth_required");
    expect(migration).toContain("status = 'reauth_required'");
    expect(migration).toContain("google_drive_stop_work_after_auth_loss");
    expect(migration).toContain("google_drive_reject_jobs_without_auth");
    expect(migration).toContain("last_error_code = case");
    expect(migration).not.toMatch(/access[_-]?token|refresh[_-]?token|authorization_code/i);
  });

  it("uses worker-only quarantine commands for selected-object imports", () => {
    const adapter = read("lib/integration-gateway/google-drive/import-adapter.ts");
    const service = read("lib/integration-gateway/file-intake/service.ts");
    const migration = read("supabase/migrations/20260826058000_remhaos_file_intake_worker_ingest.sql");
    expect(adapter).toContain("FileIntakeWorkerService");
    expect(adapter).not.toContain("humanClient");
    expect(service).toContain("create_file_intake_worker");
    expect(service).toContain("mark_file_intake_uploaded_worker");
    expect(migration).toContain("to pi_worker_executor");
    expect(migration).not.toContain("to authenticated;");
  });
});
