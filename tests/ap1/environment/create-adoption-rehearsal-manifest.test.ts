import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildManifest } from "../../../scripts/ops/create-adoption-rehearsal-manifest.mjs";

const root = resolve(__dirname, "../../..");
const snapshot = Buffer.from(JSON.stringify({ snapshot_contract: "remhaos-production-catalog/2.0", database: "postgres", captured_at: "2026-09-12T00:00:00Z", migration_ledger: Array.from({ length: 23 }, (_, index) => ({ version: String(index) })) }));

describe("adoption rehearsal manifest", () => {
  it("binds the exact current 98-entry source set to the restored clone and snapshot", () => {
    const manifest = buildManifest({ repository: root, targetRef: "reitdpzxtnmdkznesffu", snapshotBytes: snapshot, now: "2026-09-12T00:00:00Z" });
    expect(manifest.executionAuthorized).toBe(false);
    expect(manifest.source.migrationCount).toBe(98);
    expect(manifest.source.commit).toBe(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim());
    expect(manifest.preconditions.legacyHistoryCount).toBe(23);
    expect(manifest.preconditions.baselineHistoryRepair.executionAuthorized).toBe(false);
  });

  it("rejects a target ref, snapshot contract, or legacy-history count outside the reviewed contract", () => {
    expect(() => buildManifest({ repository: root, targetRef: "wrong", snapshotBytes: snapshot })).toThrow("ADOPTION_MANIFEST_TARGET_REF_INVALID");
    expect(() => buildManifest({ repository: root, targetRef: "reitdpzxtnmdkznesffu", snapshotBytes: Buffer.from("{}") })).toThrow("ADOPTION_MANIFEST_SNAPSHOT_CONTRACT_INVALID");
    expect(() => buildManifest({ repository: root, targetRef: "reitdpzxtnmdkznesffu", snapshotBytes: Buffer.from(JSON.stringify({ snapshot_contract: "remhaos-production-catalog/2.0", database: "postgres", migration_ledger: [] })) })).toThrow("ADOPTION_MANIFEST_SNAPSHOT_HISTORY_INVALID");
  });
});
