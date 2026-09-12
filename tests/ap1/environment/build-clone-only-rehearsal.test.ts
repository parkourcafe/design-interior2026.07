import { describe, expect, it } from "vitest";
import { buildCloneOnlyRehearsal } from "../../../scripts/ops/build-clone-only-rehearsal.mjs";

const command = "Для временного clone reitdpzxtnmdkznesffu разрешаю выполнить безопасную rehearsal-миграцию";
const manifest = { contract: "remhaos-adoption-rehearsal-manifest/1.0", executionAuthorized: false, target: { projectRef: "reitdpzxtnmdkznesffu" }, source: { migrationCount: 98, migrations: Array.from({ length: 98 }, (_, index) => ({ version: String(index) })) } };

describe("clone-only rehearsal builder", () => {
  it("binds only the authorized clone and creates a history-only baseline repair", () => {
    const receipt = buildCloneOnlyRehearsal({ manifest, ownerCommand: command });
    expect(receipt.targetRef).toBe("reitdpzxtnmdkznesffu");
    expect(receipt.migrations).toHaveLength(97);
    expect(receipt.baselineHistoryRepairSql).toContain("insert into supabase_migrations.schema_migrations");
    expect(receipt.baselineHistoryRepairSql).not.toMatch(/create\s+(table|schema|function)/i);
  });

  it("rejects another target, unauthorized manifest, or different command", () => {
    expect(() => buildCloneOnlyRehearsal({ manifest: { ...manifest, target: { projectRef: "ztnycrchwxqczqbyegnp" } }, ownerCommand: command })).toThrow("CLONE_REHEARSAL_TARGET_REF_FORBIDDEN");
    expect(() => buildCloneOnlyRehearsal({ manifest: { ...manifest, executionAuthorized: true }, ownerCommand: command })).toThrow("CLONE_REHEARSAL_MANIFEST_UNSAFE");
    expect(() => buildCloneOnlyRehearsal({ manifest, ownerCommand: "different" })).toThrow("CLONE_REHEARSAL_OWNER_COMMAND_MISMATCH");
  });
});
