import { describe, expect, it } from "vitest";
import { buildCloneOnlyRehearsal } from "../../../scripts/ops/build-clone-only-rehearsal.mjs";
import { buildManifest } from "../../../scripts/ops/create-adoption-rehearsal-manifest.mjs";
import { resolve } from "node:path";

const command = "Для временного clone reitdpzxtnmdkznesffu разрешаю выполнить безопасную rehearsal-миграцию";
const root = resolve(__dirname, "../../..");
const manifest = buildManifest({ repository: root, targetRef: "reitdpzxtnmdkznesffu", snapshotBytes: Buffer.from(JSON.stringify({ snapshot_contract: "remhaos-production-catalog/2.0", database: "postgres", captured_at: "2026-09-12T00:00:00Z", migration_ledger: Array.from({ length: 23 }, (_, index) => ({ version: String(index) })) })) });

describe("clone-only rehearsal builder", () => {
  it("binds only the authorized clone and creates a history-only baseline repair", () => {
    const receipt = buildCloneOnlyRehearsal({ manifest, ownerCommand: command, repository: root });
    expect(receipt.targetRef).toBe("reitdpzxtnmdkznesffu");
    expect(receipt.migrations).toHaveLength(97);
    expect(receipt.baselineHistoryRepairSql).toContain("insert into supabase_migrations.schema_migrations");
    expect(receipt.baselineHistoryRepairSql).not.toMatch(/\b(create|alter|drop|grant|revoke|update|delete)\b/i);
  });

  it("rejects another target, unauthorized manifest, or different command", () => {
    expect(() => buildCloneOnlyRehearsal({ manifest: { ...manifest, target: { projectRef: "ztnycrchwxqczqbyegnp" } }, ownerCommand: command, repository: root })).toThrow("CLONE_REHEARSAL_TARGET_REF_FORBIDDEN");
    expect(() => buildCloneOnlyRehearsal({ manifest: { ...manifest, executionAuthorized: true }, ownerCommand: command, repository: root })).toThrow("CLONE_REHEARSAL_MANIFEST_UNSAFE");
    expect(() => buildCloneOnlyRehearsal({ manifest: { ...manifest, source: { ...manifest.source, migrations: manifest.source.migrations.slice().reverse() } }, ownerCommand: command, repository: root })).toThrow("CLONE_REHEARSAL_MANIFEST_LEDGER_MISMATCH");
  });
});
