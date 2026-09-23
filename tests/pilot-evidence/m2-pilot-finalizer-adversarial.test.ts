/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial JSON mutations intentionally cross the runtime trust boundary */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { finalizeM2PilotEvidence, runPilotExecutor } from "./finalize-m2-pilot-evidence";
import { buildExternalProofFixture } from "./proof-fixture";
import { prepareM2PilotEvidence } from "./run-m2-pilot-evidence";

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

const ids = {
  org: "a1111111-1111-4111-8111-111111111111", project: "a2222222-2222-4222-8222-222222222222",
  package: "a3333333-3333-4333-8333-333333333333", submission: "94444444-4444-4444-8444-444444444444",
  review: "95555555-5555-4555-8555-555555555555", commit: "96666666-6666-4666-8666-666666666666",
  handoff: "97777777-7777-4777-8777-777777777777",
};
const sha = (character: string) => `sha256:${character.repeat(64)}`;
const uuid = (index: number) => `88000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const commandRoles = ["owner_lead", "owner_lead", "client_approver", "client_approver", "owner_lead"] as const;
const PENDING_MANIFEST = readFileSync("tests/fixtures/cycle7/external-package.manifest.json", "utf8");

function receipt(manifestDigest = sha("a")) {
  const roles = ["owner_lead", "architect", "client_approver", "builder", "guest"];
  const sessions = roles.map((role, index) => {
    const sessionId = uuid(index + 6);
    return {
      role, userId: uuid(index + 1), sessionId, requestId: uuid(index + 11),
      serverSessionDigest: `sha256:${createHash("sha256").update(sessionId).digest("hex")}`,
    };
  });
  const commands = ["publish_m2_layout_version", "submit_m2_client_review", "review_m2_client_submission", "append_m2_approved_commit_revision", "publish_m2_m3_handoff"].map((operation, index) => ({
    role: commandRoles[index]!,
    replayMode: index === 3 ? "parent_atomic_side_effect" : "direct",
    operation, commandId: uuid(index + 16), requestId: uuid(index === 3 ? 23 : index + 21), auditEventId: uuid(index + 26),
    actorUserId: sessions.find((session) => session.role === commandRoles[index])!.userId,
    actorSessionId: sessions.find((session) => session.role === commandRoles[index])!.sessionId,
    actorSessionDigest: sessions.find((session) => session.role === commandRoles[index])!.serverSessionDigest,
    organizationId: ids.org, projectId: ids.project, packageId: ids.package,
    previousStateRevision: 40 + index, resultingStateRevision: 41 + index,
    resultDigest: sha(String((index + 1) % 10)), replayDigest: sha(String((index + 1) % 10)), replayEqual: true,
  }));
  return {
    status: "MANIFEST_VALIDATED_PENDING_RUN", challengeNonce: "cycle7-challenge-7f0d9c",
    manifestDigest, executor: { path: "tests/pilot-evidence/run-m2-pilot-evidence.zsh",
      digest: `sha256:${createHash("sha256").update(readFileSync("tests/pilot-evidence/run-m2-pilot-evidence.zsh")).digest("hex")}`,
      repoOwned: true, verificationReceiptId: uuid(40) },
    scope: { organizationId: ids.org, projectId: ids.project, packageId: ids.package }, sessions, commands,
    lineage: { submissionId: ids.submission, submissionRevisionId: uuid(31), reviewId: ids.review, reviewRevisionId: uuid(32),
      approvedCommitId: ids.commit, approvedCommitRevisionId: uuid(33), clientSubmissionId: ids.submission,
      clientReviewRevisionId: uuid(32), handoffId: ids.handoff, handoffRevisionId: uuid(34),
      handoffApprovedCommitId: ids.commit, handoffApprovedCommitRevisionId: uuid(33) },
    proofs: buildExternalProofFixture({
      scope: { organizationId: ids.org, projectId: ids.project, packageId: ids.package }, commands,
      manifestDigest, challengeNonce: "cycle7-challenge-7f0d9c", uuid,
      sha: (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`,
    }),
    runFiveSessions: { marker: "RUN_FIVE_REQUEST_BOUND_SESSIONS", receiptId: uuid(45), sessions },
  };
}

function outputDir() { const path = mkdtempSync(join(tmpdir(), "cycle7-finalizer-")); temporary.push(path); return path; }
function assertNoArtifacts(path: string) { expect(existsSync(join(path, "PASS.json"))).toBe(false); expect(existsSync(join(path, "PASS.json.tmp"))).toBe(false); }
function validFinalization() {
  const out = outputDir();
  const manifestPath = join(out, "external-manifest.json");
  writeFileSync(manifestPath, PENDING_MANIFEST);
  const value: any = receipt(`sha256:${createHash("sha256").update(PENDING_MANIFEST).digest("hex")}`);
  const koraReceiptPath = join(out, "KORA_RECEIPT.json");
  writeFileSync(koraReceiptPath, JSON.stringify(value.runFiveSessions));
  const pendingPath = join(out, "PENDING.json");
  const pending = prepareM2PilotEvidence({
    outputPath: pendingPath,
    challengeNonce: value.challengeNonce,
    manifestDigest: value.manifestDigest,
    executor: value.executor,
    koraReceipt: value.runFiveSessions,
    koraReceiptPath,
  });
  value.pendingBinding = pending.pendingBinding;
  return { value, out, options: { outputDir: out, manifestPath, pendingPath, pending, koraReceiptPath } };
}
function expectRejected(mutate: (value: any) => void, code: string) {
  const { value, out, options } = validFinalization();
  mutate(value);
  expect(() => finalizeM2PilotEvidence(value, options)).toThrow(code);
  assertNoArtifacts(out);
}

describe("Cycle 7 executable finalizer adversarial gate", () => {
  it("builds a complete accepted manifest, pending binding and protected Kora receipt", () => {
    const { value, out, options } = validFinalization();
    expect(() => finalizeM2PilotEvidence(value, options)).not.toThrow();
    expect(existsSync(join(out, "PASS.json"))).toBe(true);
  });

  it("rejects arbitrary executor path/digest and requires repo ownership plus challenge nonce", () => {
    for (const mutate of [
      (value: any) => { value.executor.path = "/tmp/evil.sh"; },
      (value: any) => { value.executor.digest = sha("f"); },
      (value: any) => { value.executor.repoOwned = false; },
    ]) expectRejected(mutate, "RECEIPT_TAMPERED_EXECUTOR");

    const { value, out, options } = validFinalization();
    value.challengeNonce = "";
    (options.pending as any).challengeNonce = "";
    writeFileSync(options.pendingPath, JSON.stringify(options.pending, null, 2));
    expect(() => finalizeM2PilotEvidence(value, options)).toThrow("RECEIPT_TAMPERED_EXECUTOR");
    assertNoArtifacts(out);
  });

  it("requires exactly five distinct UUID user/session/request bindings and one of each role", () => {
    for (const mutate of [
      (v: any) => { v.sessions.pop(); }, (v: any) => { v.sessions[4].userId = v.sessions[0].userId; },
      (v: any) => { v.sessions[4].sessionId = v.sessions[0].sessionId; }, (v: any) => { v.sessions[4].requestId = ""; },
      (v: any) => { v.sessions[4].role = "owner_lead"; },
    ]) expectRejected(mutate, "RECEIPT_TAMPERED_SESSIONS");
  });

  it("rejects empty/tampered command receipts, scope, replay digests and unlinked states", () => {
    for (const mutate of [
      (v: any) => { v.commands[0].commandId = ""; }, (v: any) => { v.commands[0].auditEventId = "not-uuid"; },
      (v: any) => { v.commands[1].actorSessionId = uuid(49); }, (v: any) => { v.commands[2].role = "owner_lead"; },
      (v: any) => { v.commands[2].packageId = uuid(50); },
      (v: any) => { v.commands[2].replayDigest = sha("f"); }, (v: any) => { v.commands[2].replayEqual = false; },
      (v: any) => { v.commands[3].previousStateRevision = 999; },
    ]) expectRejected(mutate, "RECEIPT_TAMPERED_COMMAND_REPLAY");
  });

  it("requires exact persisted submission-review-commit-handoff lineage and receipt proof objects", () => {
    for (const [mutate, code] of [
      [(v: any) => { v.lineage.clientSubmissionId = uuid(51); }, "RECEIPT_TAMPERED_LINEAGE"],
      [(v: any) => { v.lineage.handoffApprovedCommitRevisionId = uuid(52); }, "RECEIPT_TAMPERED_LINEAGE"],
      [(v: any) => { v.proofs.audit = true; }, "RECEIPT_TAMPERED_PROOF"],
      [(v: any) => { delete v.proofs.tenancy.queryRequestId; }, "RECEIPT_TAMPERED_PROOF"],
    ] as const) expectRejected(mutate, code);
  });

  it("requires the protected Kora receipt path even when a self-declared marker is present", () => {
    const { value, out, options } = validFinalization();
    expect(() => finalizeM2PilotEvidence(value, { ...options, koraReceiptPath: undefined })).toThrow("KORA_RECEIPT_REQUIRED");
    assertNoArtifacts(out);
  });

  it("rejects secret/path traversal privacy tokens", () => {
    for (const token of ["sk-secret", "sbp_token", "refresh_token", "/Volumes/private", "/mnt/package", "../escape"]) {
      expectRejected((value) => { value.proofs.privacy.detail = token; }, "RECEIPT_TAMPERED_PRIVACY");
    }
  });

  it("captures/redacts executor stdout and cleans temp/PASS on shell failure", async () => {
    const dir = outputDir(); const script = join(dir, "fail.sh");
    writeFileSync(script, "#!/bin/sh\necho 'sk-secret /Users/private sbp_token'\necho failure >&2\nexit 9\n", { mode: 0o700 });
    await expect(runPilotExecutor({ executorPath: script, challengeNonce: "nonce", outputDir: dir })).rejects.toThrow();
    assertNoArtifacts(dir);
    const failure = readFileSync(join(dir, "FAILURE.json"), "utf8");
    expect(failure).not.toMatch(/sk-secret|\/Users\/private|sbp_token/);
    expect(failure).toContain("[REDACTED]");
  });
});
