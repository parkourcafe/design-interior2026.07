/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial JSON mutations intentionally cross the runtime trust boundary */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { finalizeM2PilotEvidence } from "./finalize-m2-pilot-evidence";
import { prepareM2PilotEvidence } from "./run-m2-pilot-evidence";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const sha = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const uuid = (index: number) => `99000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const roles = ["owner_lead", "architect", "client_approver", "builder", "guest"];
const operations = ["publish_m2_layout_version", "submit_m2_client_review", "review_m2_client_submission", "append_m2_approved_commit_revision", "publish_m2_m3_handoff"];

function outputDir() { const root = mkdtempSync(join(tmpdir(), "cycle7-identity-")); roots.push(root); return root; }
function receipt(textEntityIds = false) {
  const scope = { organizationId: uuid(1), projectId: uuid(2), packageId: uuid(3) };
  const executorPath = "tests/pilot-evidence/run-m2-pilot-evidence.zsh";
  const executorDigest = sha(readFileSync(executorPath));
  const sessions = roles.map((role, index) => ({ role, userId: uuid(10 + index), sessionId: uuid(20 + index), requestId: uuid(30 + index) }));
  const entity = (prefix: string, index: number) => textEntityIds ? `${prefix}-external-room` : uuid(index);
  const submissionId = entity("submission", 80); const reviewId = entity("submission", 81);
  const approvedCommitId = entity("approved", 82); const handoffId = entity("handoff", 83);
  return { status: "MANIFEST_VALIDATED_PENDING_RUN", challengeNonce: "cycle7-challenge-7f0d9c", manifestDigest: sha("manifest"),
    executor: { path: executorPath, digest: executorDigest, repoOwned: true, verificationReceiptId: uuid(41) }, scope, sessions,
    commands: operations.map((operation, index) => ({ operation, commandId: uuid(50 + index), requestId: uuid(60 + index), auditEventId: uuid(70 + index),
      actorUserId: sessions[Math.min(index, 2)]!.userId, actorSessionId: sessions[Math.min(index, 2)]!.sessionId, ...scope,
      previousStateRevision: 100 + index, resultingStateRevision: 101 + index, resultDigest: sha(`result-${index}`), replayDigest: sha(`result-${index}`), replayEqual: true })),
    lineage: { submissionId, submissionRevisionId: uuid(84), reviewId, reviewRevisionId: uuid(85), approvedCommitId,
      approvedCommitRevisionId: uuid(86), clientSubmissionId: submissionId, clientReviewRevisionId: uuid(85), handoffId,
      handoffRevisionId: uuid(87), handoffApprovedCommitId: approvedCommitId, handoffApprovedCommitRevisionId: uuid(86) },
    proofs: Object.fromEntries(["audit", "authenticatedRead", "privacy", "tenancy", "replay"].map((name, index) => [name,
      { queryReceiptId: uuid(90 + index), auditReceiptId: uuid(100 + index), digest: sha(`proof-${index}`) }])),
    runFiveSessions: { marker: "RUN_FIVE_REQUEST_BOUND_SESSIONS", receiptId: uuid(110), digest: sha("kora-machine-receipt"), sessions },
    pendingBinding: { executorPath, executorDigest, executorVerificationReceiptId: uuid(41), koraReceiptDigest: sha("kora-machine-receipt") },
  };
}

describe("Cycle 7 executor and Kora receipt identity binding", () => {
  it("orders the executable shell flow as nonce -> official producer -> receipt digest -> prepare", () => {
    const shell = readFileSync("tests/pilot-evidence/run-m2-pilot-evidence.zsh", "utf8");
    const nonce = shell.indexOf("challenge_nonce=");
    const invokeProducer = shell.indexOf('"${kora_producer_absolute}" "${challenge_nonce}" "${kora_five_receipt}"');
    const digestReceipt = shell.indexOf('kora_receipt_digest=$(shasum -a 256 "${kora_five_receipt}"');
    const prepare = shell.indexOf("run-m2-pilot-evidence.ts prepare");
    expect(nonce).toBeGreaterThan(-1); expect(invokeProducer).toBeGreaterThan(nonce);
    expect(digestReceipt).toBeGreaterThan(invokeProducer); expect(prepare).toBeGreaterThan(digestReceipt);
    expect(shell.slice(prepare, prepare + 900)).toContain('"${kora_receipt_digest}"');
  });

  it("prepare accepts an explicit shell-computed receipt digest without mutating producer identity into the receipt", () => {
    const value: any = receipt(); const out = outputDir(); const pendingPath = join(out, "PENDING.json");
    const receiptPath = join(out, "KORA_RECEIPT.json"); delete value.runFiveSessions.digest; delete value.runFiveSessions.producer;
    writeFileSync(receiptPath, JSON.stringify(value.runFiveSessions)); const computedDigest = sha(readFileSync(receiptPath));
    const before = readFileSync(receiptPath, "utf8");
    const pending: any = prepareM2PilotEvidence({ outputPath: pendingPath, challengeNonce: value.challengeNonce,
      manifestDigest: value.manifestDigest, executor: value.executor, koraReceipt: value.runFiveSessions,
      koraReceiptPath: receiptPath, koraReceiptDigest: computedDigest } as any);
    expect(readFileSync(receiptPath, "utf8")).toBe(before);
    expect(value.runFiveSessions.producer).toBeUndefined();
    expect(pending.pendingBinding.koraReceiptDigest).toBe(computedDigest);
  });

  it("finalizer rereads the protected Kora receipt and rejects stale/handwritten replacement", () => {
    const value: any = receipt(); const out = outputDir(); const pendingPath = join(out, "PENDING.json");
    const receiptPath = join(out, "KORA_RECEIPT.json");
    writeFileSync(receiptPath, JSON.stringify(value.runFiveSessions)); const computedDigest = sha(readFileSync(receiptPath));
    const pending = prepareM2PilotEvidence({ outputPath: pendingPath, challengeNonce: value.challengeNonce,
      manifestDigest: value.manifestDigest, executor: value.executor, koraReceipt: value.runFiveSessions,
      koraReceiptPath: receiptPath, koraReceiptDigest: computedDigest } as any);
    writeFileSync(receiptPath, JSON.stringify({ ...value.runFiveSessions, receiptId: uuid(119) }));
    expect(() => finalizeM2PilotEvidence(value, { outputDir: out, pending, pendingPath, koraReceiptPath: receiptPath } as any)).toThrow();
    expect(existsSync(join(out, "PASS.json"))).toBe(false);
  });

  it("validates external and Kora five-session sets independently instead of requiring byte-equal identities", () => {
    const value: any = receipt(); const out = outputDir(); const pendingPath = join(out, "PENDING.json");
    value.runFiveSessions.sessions = roles.map((role, index) => ({ role, userId: uuid(120 + index), sessionId: uuid(130 + index), requestId: uuid(140 + index) }));
    const pending = prepareM2PilotEvidence({ outputPath: pendingPath, challengeNonce: value.challengeNonce,
      manifestDigest: value.manifestDigest, executor: value.executor, koraReceipt: value.runFiveSessions });
    expect(() => finalizeM2PilotEvidence(value, { outputDir: out, pending, pendingPath })).not.toThrow();
  });

  it("refuses direct finalization when no genuine prepare-produced pending artifact is supplied", () => {
    const value: any = receipt(); const out = outputDir();
    expect(() => finalizeM2PilotEvidence(value, { outputDir: out })).toThrow();
    expect(existsSync(join(out, "PASS.json"))).toBe(false);
  });

  it("uses the exported prepare writer and passes its parsed pending artifact/path into finalization", async () => {
    const runner: any = await import("./run-m2-pilot-evidence");
    expect(runner.prepareM2PilotEvidence).toBeTypeOf("function");
    const out = outputDir(); const pendingPath = join(out, "PENDING.json"); const value: any = receipt();
    const pending = runner.prepareM2PilotEvidence({
      outputPath: pendingPath, challengeNonce: value.challengeNonce, manifestDigest: value.manifestDigest,
      executor: value.executor, koraReceipt: value.runFiveSessions,
    });
    expect(pending).toEqual(JSON.parse(readFileSync(pendingPath, "utf8")));
    expect(() => finalizeM2PilotEvidence(value, { outputDir: out, pending, pendingPath } as any)).not.toThrow();
    expect(existsSync(join(out, "PASS.json"))).toBe(true);
  });

  it("rejects a Kora receipt produced by a different repo harness than prepare bound", () => {
    const value: any = receipt(); const out = outputDir();
    const producerPath = "tests/pilot-evidence/run-m2-pilot-evidence.zsh";
    value.runFiveSessions.producer = { path: producerPath, digest: sha(readFileSync(producerPath)), repoOwned: true, challengeNonce: value.challengeNonce };
    const otherPath = "tests/pilot-evidence/finalize-m2-pilot-evidence-cli.ts";
    const pending = { status: "MANIFEST_VALIDATED_PENDING_RUN", challengeNonce: value.challengeNonce,
      externalManifestDigest: value.manifestDigest, pendingBinding: { ...value.pendingBinding,
        koraProducerPath: otherPath, koraProducerDigest: sha(readFileSync(otherPath)), koraChallengeNonce: value.challengeNonce } };
    expect(() => finalizeM2PilotEvidence(value, { outputDir: out, pending, pendingPath: join(out, "PENDING.json") } as any)).toThrow();
    expect(existsSync(join(out, "PASS.json"))).toBe(false);
  });

  it("rejects verified executor A when the receipt claims repo file B", () => {
    const value: any = receipt(); const out = outputDir();
    value.pendingBinding.executorPath = "tests/pilot-evidence/finalize-m2-pilot-evidence.ts";
    value.pendingBinding.executorDigest = sha(readFileSync(value.pendingBinding.executorPath));
    expect(() => finalizeM2PilotEvidence(value, { outputDir: out })).toThrow();
    expect(existsSync(join(out, "PASS.json"))).toBe(false);
  });

  it("rejects a self-declared five-session marker not digest-bound to the pending Kora receipt", () => {
    const value: any = receipt(); const out = outputDir();
    value.runFiveSessions = { ...value.runFiveSessions, receiptId: uuid(111), digest: sha("self-declared") };
    expect(() => finalizeM2PilotEvidence(value, { outputDir: out })).toThrow();
    expect(existsSync(join(out, "PASS.json"))).toBe(false);
  });

  it("accepts bounded production entity IDs, requires UUID revisions, and publishes both identity bindings", () => {
    const value: any = receipt(true); const out = outputDir();
    expect(value.lineage.submissionId).toMatch(/^submission-/); expect(value.lineage.approvedCommitId).toMatch(/^approved-/);
    expect(value.lineage.handoffId).toMatch(/^handoff-/); expect(value.lineage.submissionRevisionId).toMatch(/^[0-9a-f-]{36}$/);
    const pendingPath = join(out, "PENDING.json");
    const pending = prepareM2PilotEvidence({
      outputPath: pendingPath, challengeNonce: value.challengeNonce, manifestDigest: value.manifestDigest,
      executor: value.executor, koraReceipt: value.runFiveSessions,
    });
    expect(pending).toEqual(JSON.parse(readFileSync(pendingPath, "utf8")));
    finalizeM2PilotEvidence(value, { outputDir: out, pending, pendingPath });
    const pass = JSON.parse(readFileSync(join(out, "PASS.json"), "utf8"));
    expect(pass.executor).toMatchObject({ path: value.executor.path, digest: value.executor.digest, verificationReceiptId: value.executor.verificationReceiptId });
    expect(pass.koraRun).toMatchObject({ receiptId: value.runFiveSessions.receiptId, digest: value.runFiveSessions.digest });
  });
});
