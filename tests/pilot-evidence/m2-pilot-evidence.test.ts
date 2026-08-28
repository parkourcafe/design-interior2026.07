import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPilotManifest, validateExternalPilot, validateKoraPilot } from "./m2-pilot-evidence-contract";

const koraPath = "tests/fixtures/cycle7/kora-one-room-pilot.json";
const harnessPath = "tests/pilot-evidence/run-m2-pilot-evidence.zsh";

function fabricatedManifest() {
  const variants = (["preferred", "value_engineered", "premium"] as const).map((role, index) => ({
    role, layoutRevisionId: `7${index + 1}111111-1111-4111-8111-111111111111`,
    semanticHash: `sha256:${String(index + 1).repeat(64)}`,
    selections: [{ revisionId: `selection-${index + 1}`, priceObservation: { amountRub: 125000,
      observedAt: "2026-08-06T10:00:00Z", evidence: { sourceRevisionId: "source-r1", evidenceLinkId: "evidence-1", fragmentId: "fragment-1" } } }],
  }));
  return { status: "pending", synthetic: false, provenance: { kind: "external_real_package", provider: "external-provider", receivedAt: "2026-08-06T10:00:00Z" },
    project: { name: "External venue" }, scope: { organizationId: "71111111-1111-4111-8111-111111111111", projectId: "72222222-2222-4222-8222-222222222222", packageId: "73333333-3333-4333-8333-333333333333", roomId: "external-room" },
    sources: [{ externalRef: "provider-document-1", checksum: `sha256:${"a".repeat(64)}` }], m2: { variants },
    authenticatedExercise: { environment: "disposable", productionChanged: false,
      operations: ["publish_m2_layout_version", "submit_m2_client_review", "review_m2_client_submission", "publish_m2_m3_handoff"].map((kind) => ({ kind, status: "pending", replayVerified: false })),
      auditVerified: false, privacyVerified: false, tenancyVerified: false, restartVerified: false } };
}

describe("Cycle 7 executable M2 pilot evidence gate", () => {
  it("keeps Kora as a full 1800m² project while selecting one explicit package/room", () => {
    const kora = readPilotManifest(koraPath);
    expect(() => validateKoraPilot(kora)).not.toThrow();
    expect(kora.project).toMatchObject({ name: "Kora Food Hall", model: "full_project", areaM2: 1800 });
    expect(kora.selectedScope).toMatchObject({ packageId: expect.any(String), roomId: expect.any(String) });
    expect(kora.evidenceClass).toBe("local_fixture_not_production");
  });

  // Требование внешнего манифеста живёт в
  // m2-pilot-external-manifest.gate.test.ts и запускается через
  // `npm run test:cycle7`. Оно намеренно красное, пока пакета нет, и поэтому
  // вынесено из повседневной сюиты — чтобы красный CI не стал фоном.

  it("fails closed for absent provenance, synthetic packages and Kora clones", () => {
    const kora = readPilotManifest(koraPath);
    const base = { status: "pending", synthetic: false, provenance: { kind: "external_real_package", provider: "supplier", receivedAt: "2026-08-06T10:00:00Z" },
      project: { name: "External package" }, scope: { organizationId: "71111111-1111-4111-8111-111111111111", projectId: "72222222-2222-4222-8222-222222222222", packageId: "73333333-3333-4333-8333-333333333333", roomId: "external-room" },
      sources: [{ externalRef: "provider-document-1", checksum: `sha256:${"a".repeat(64)}` }] };
    expect(() => validateExternalPilot({ ...base, synthetic: true }, kora)).toThrow("CYCLE7_EXTERNAL_SYNTHETIC_FORBIDDEN");
    expect(() => validateExternalPilot({ ...base, provenance: null }, kora)).toThrow("CYCLE7_EXTERNAL_PROVENANCE_REQUIRED");
    expect(() => validateExternalPilot({ ...base, project: { name: "Kora Food Hall" } }, kora)).toThrow("CYCLE7_KORA_CLONE_FORBIDDEN");
    expect(() => validateExternalPilot({ ...base, sources: [] }, kora)).toThrow("CYCLE7_EXTERNAL_SOURCE_CHECKSUMS_REQUIRED");
  });

  it("allows a shape-valid manifest to reach only pending-run, never PASS", () => {
    const result = validateExternalPilot(fabricatedManifest(), readPilotManifest(koraPath));
    expect(result).toMatchObject({ status: "MANIFEST_VALIDATED_PENDING_RUN", manifestDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) });
    expect(JSON.stringify(result)).not.toContain('"PASS"');
  });

  it("rejects checksum overlap, renamed clones and private path/production filename leakage", () => {
    const external = fabricatedManifest();
    const kora = { ...readPilotManifest(koraPath), sources: [{ checksum: external.sources[0]!.checksum }] };
    expect(() => validateExternalPilot(external, kora)).toThrow("CYCLE7_KORA_SOURCE_OVERLAP_FORBIDDEN");
    for (const externalRef of ["/Users/private/client.pdf", "file:///private/package.pdf", "Kora-production-plan.pdf"]) {
      expect(() => validateExternalPilot({ ...external, sources: [{ ...external.sources[0], externalRef }] }, readPilotManifest(koraPath))).toThrow("CYCLE7_EXTERNAL_PRIVACY_INVALID");
    }
    expect(() => validateExternalPilot({ ...external, provenance: { ...external.provenance, provider: "/home/operator/provider" } }, readPilotManifest(koraPath))).toThrow("CYCLE7_EXTERNAL_PRIVACY_INVALID");
  });

  it("requires an executable request-bound harness for the identical two-manifest flow", () => {
    expect(existsSync(harnessPath), `CYCLE7_HARNESS_REQUIRED:${harnessPath}`).toBe(true);
    accessSync(harnessPath, constants.X_OK);
    const harness = readFileSync(harnessPath, "utf8");
    expect(harness).toContain("ARCHIDOM_EXTERNAL_PILOT_MANIFEST");
    for (const operation of ["publish_m2_layout_version", "submit_m2_client_review", "review_m2_client_submission", "publish_m2_m3_handoff"]) {
      expect(harness).toContain(operation);
    }
    for (const proof of ["replay", "audit", "privacy", "tenancy", "restart"]) expect(harness).toMatch(new RegExp(proof, "i"));
    expect(harness).not.toMatch(/service_role|serviceRole/);
  });

  it("requires atomic PASS finalization from complete untampered machine receipts", () => {
    const finalizerPath = "tests/pilot-evidence/finalize-m2-pilot-evidence.ts";
    expect(existsSync(finalizerPath), `CYCLE7_FINALIZER_REQUIRED:${finalizerPath}`).toBe(true);
    const source = readFileSync(finalizerPath, "utf8");
    for (const proof of ["manifestDigest", "fiveDistinctUsers", "organizationId", "projectId", "packageId",
      "commandIds", "stateRevisions", "replay", "submission", "review", "approvedCommit", "handoff",
      "audit", "authenticatedRead", "privacy", "tenancy"]) expect(source).toContain(proof);
    expect(source).toMatch(/MANIFEST_VALIDATED_PENDING_RUN/);
    expect(source).toMatch(/RECEIPT_MISSING/);
    expect(source).toMatch(/RECEIPT_TAMPERED|DIGEST_MISMATCH/);
    expect(source).toMatch(/owner_lead[^]*architect[^]*client_approver[^]*builder[^]*guest/);
    expect(source).toMatch(/renameSync|atomic/i);
    expect(source).toMatch(/unlinkSync|rmSync/);
    expect(source).toMatch(/catch[^]*(?:unlinkSync|rmSync)|(?:unlinkSync|rmSync)[^]*throw/s);
  });
});
