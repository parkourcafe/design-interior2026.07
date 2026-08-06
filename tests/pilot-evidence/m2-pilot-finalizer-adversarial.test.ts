/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial JSON mutations intentionally cross the runtime trust boundary */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

const ids = {
  org: "91111111-1111-4111-8111-111111111111", project: "92222222-2222-4222-8222-222222222222",
  package: "93333333-3333-4333-8333-333333333333", submission: "94444444-4444-4444-8444-444444444444",
  review: "95555555-5555-4555-8555-555555555555", commit: "96666666-6666-4666-8666-666666666666",
  handoff: "97777777-7777-4777-8777-777777777777",
};
const sha = (character: string) => `sha256:${character.repeat(64)}`;
const uuid = (index: number) => `88000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

function receipt() {
  const roles = ["owner_lead", "architect", "client_approver", "builder", "guest"];
  const sessions = roles.map((role, index) => ({ role, userId: uuid(index + 1), sessionId: uuid(index + 6), requestId: uuid(index + 11) }));
  const commands = ["publish_m2_layout_version", "submit_m2_client_review", "review_m2_client_submission", "append_m2_approved_commit_revision", "publish_m2_m3_handoff"].map((operation, index) => ({
    operation, commandId: uuid(index + 16), requestId: uuid(index + 21), auditEventId: uuid(index + 26),
    actorUserId: sessions[Math.min(index, 2)]!.userId, actorSessionId: sessions[Math.min(index, 2)]!.sessionId,
    organizationId: ids.org, projectId: ids.project, packageId: ids.package,
    previousStateRevision: 40 + index, resultingStateRevision: 41 + index,
    resultDigest: sha(String((index + 1) % 10)), replayDigest: sha(String((index + 1) % 10)), replayEqual: true,
  }));
  return {
    status: "MANIFEST_VALIDATED_PENDING_RUN", challengeNonce: "cycle7-challenge-7f0d9c",
    manifestDigest: sha("a"), executor: { path: "tests/pilot-evidence/run-m2-pilot-evidence.zsh",
      digest: `sha256:${createHash("sha256").update(readFileSync("tests/pilot-evidence/run-m2-pilot-evidence.zsh")).digest("hex")}`, repoOwned: true },
    scope: { organizationId: ids.org, projectId: ids.project, packageId: ids.package }, sessions, commands,
    lineage: { submissionId: ids.submission, submissionRevisionId: uuid(31), reviewId: ids.review, reviewRevisionId: uuid(32),
      approvedCommitId: ids.commit, approvedCommitRevisionId: uuid(33), clientSubmissionId: ids.submission,
      clientReviewRevisionId: uuid(32), handoffId: ids.handoff, handoffRevisionId: uuid(34),
      handoffApprovedCommitId: ids.commit, handoffApprovedCommitRevisionId: uuid(33) },
    proofs: Object.fromEntries(["audit", "authenticatedRead", "privacy", "tenancy", "replay"].map((name, index) => [name, { queryReceiptId: uuid(35 + index), auditReceiptId: uuid(40 + index), digest: sha(String(index + 4)) }])),
    runFiveSessions: { marker: "RUN_FIVE_REQUEST_BOUND_SESSIONS", receiptId: uuid(45) },
  };
}

async function api() { return import("./finalize-m2-pilot-evidence"); }
function outputDir() { const path = mkdtempSync(join(tmpdir(), "cycle7-finalizer-")); temporary.push(path); return path; }
function assertNoArtifacts(path: string) { expect(existsSync(join(path, "PASS.json"))).toBe(false); expect(existsSync(join(path, "PASS.json.tmp"))).toBe(false); }

describe("Cycle 7 executable finalizer adversarial gate", () => {
  it("rejects arbitrary executor path/digest and requires repo ownership plus challenge nonce", async () => {
    const { finalizeM2PilotEvidence } = await api();
    for (const mutate of [
      (value: any) => { value.executor.path = "/tmp/evil.sh"; },
      (value: any) => { value.executor.digest = sha("f"); },
      (value: any) => { value.executor.repoOwned = false; },
      (value: any) => { value.challengeNonce = ""; },
    ]) { const value = receipt(); mutate(value); const out = outputDir(); expect(() => finalizeM2PilotEvidence(value, { outputDir: out })).toThrow(); assertNoArtifacts(out); }
  });

  it("requires exactly five distinct UUID user/session/request bindings and one of each role", async () => {
    const { finalizeM2PilotEvidence } = await api();
    for (const mutate of [
      (v: any) => { v.sessions.pop(); }, (v: any) => { v.sessions[4].userId = v.sessions[0].userId; },
      (v: any) => { v.sessions[4].sessionId = v.sessions[0].sessionId; }, (v: any) => { v.sessions[4].requestId = ""; },
      (v: any) => { v.sessions[4].role = "owner_lead"; },
    ]) { const value = receipt(); mutate(value); const out = outputDir(); expect(() => finalizeM2PilotEvidence(value, { outputDir: out })).toThrow(); assertNoArtifacts(out); }
  });

  it("rejects empty/tampered command receipts, scope, replay digests and unlinked states", async () => {
    const { finalizeM2PilotEvidence } = await api();
    for (const mutate of [
      (v: any) => { v.commands[0].commandId = ""; }, (v: any) => { v.commands[0].auditEventId = "not-uuid"; },
      (v: any) => { v.commands[1].actorSessionId = uuid(49); }, (v: any) => { v.commands[2].packageId = uuid(50); },
      (v: any) => { v.commands[2].replayDigest = sha("f"); }, (v: any) => { v.commands[2].replayEqual = false; },
      (v: any) => { v.commands[3].previousStateRevision = 999; },
    ]) { const value = receipt(); mutate(value); const out = outputDir(); expect(() => finalizeM2PilotEvidence(value, { outputDir: out })).toThrow(); assertNoArtifacts(out); }
  });

  it("requires exact persisted submission-review-commit-handoff lineage and receipt proof objects", async () => {
    const { finalizeM2PilotEvidence } = await api();
    for (const mutate of [
      (v: any) => { v.lineage.clientSubmissionId = uuid(51); },
      (v: any) => { v.lineage.handoffApprovedCommitRevisionId = uuid(52); },
      (v: any) => { v.proofs.audit = true; }, (v: any) => { delete v.proofs.tenancy.queryReceiptId; },
    ]) { const value = receipt(); mutate(value); const out = outputDir(); expect(() => finalizeM2PilotEvidence(value, { outputDir: out })).toThrow(); assertNoArtifacts(out); }
  });

  it("keeps Kora pending without an actual five-session run marker/receipt", async () => {
    const { finalizeM2PilotEvidence } = await api(); const value = receipt(); delete (value as any).runFiveSessions;
    const out = outputDir(); expect(() => finalizeM2PilotEvidence(value, { outputDir: out, label: "Kora Food Hall" })).toThrow(); assertNoArtifacts(out);
  });

  it("rejects secret/path traversal privacy tokens", async () => {
    const { finalizeM2PilotEvidence } = await api();
    for (const token of ["sk-secret", "sbp_token", "refresh_token", "/Volumes/private", "/mnt/package", "../escape"]) {
      const value = receipt() as any; value.proofs.privacy.detail = token; const out = outputDir();
      expect(() => finalizeM2PilotEvidence(value, { outputDir: out })).toThrow(); assertNoArtifacts(out);
    }
  });

  it("captures/redacts executor stdout and cleans temp/PASS on shell failure", async () => {
    const { runPilotExecutor } = await api(); const dir = outputDir(); const script = join(dir, "fail.sh");
    writeFileSync(script, "#!/bin/sh\necho 'sk-secret /Users/private sbp_token'\necho failure >&2\nexit 9\n", { mode: 0o700 });
    await expect(runPilotExecutor({ executorPath: script, challengeNonce: "nonce", outputDir: dir })).rejects.toThrow();
    assertNoArtifacts(dir);
    const failure = readFileSync(join(dir, "FAILURE.json"), "utf8");
    expect(failure).not.toMatch(/sk-secret|\/Users\/private|sbp_token/);
    expect(failure).toContain("[REDACTED]");
  });
});
