import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve, relative, join } from "node:path";

type UnknownObject = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^sha256:[0-9a-f]{64}$/;
const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/;
const roles = ["owner_lead", "architect", "client_approver", "builder", "guest"] as const;
const operations = ["publish_m2_layout_version", "submit_m2_client_review", "review_m2_client_submission", "append_m2_approved_commit_revision", "publish_m2_m3_handoff"] as const;
const privateData = /sk-[a-z0-9_-]+|sbp_token|refresh_token|\/Users\/|\/Volumes\/|\/mnt\/|\.\.\/|bearer\s+\S+/i;
const privateDataGlobal = /sk-[a-z0-9_-]+|sbp_token|refresh_token|\/Users\/|\/Volumes\/|\/mnt\/|\.\.\/|bearer\s+\S+/gi;
const HEAD_SHA = /^[0-9a-f]{40}$/;
const object = (value: unknown): UnknownObject => value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownObject : {};
const list = (value: unknown): UnknownObject[] => Array.isArray(value) ? value.map(object) : [];
const string = (value: unknown): string => typeof value === "string" ? value : "";
const fileDigest = (path: string) => `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
const redact = (value: string) => value.replace(privateDataGlobal, "[REDACTED]");
const currentHeadSha = (): string => {
  const value = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!HEAD_SHA.test(value)) throw new Error("RUNTIME_RECEIPT_HEAD_SHA_INVALID");
  return value;
};
const validFiveSessions = (sessions: UnknownObject[]): boolean => sessions.length === 5
  && new Set(sessions.map((item) => string(item.userId))).size === 5
  && new Set(sessions.map((item) => string(item.sessionId))).size === 5
  && new Set(sessions.map((item) => string(item.requestId))).size === 5
  && roles.every((role) => sessions.filter((item) => item.role === role).length === 1)
  && sessions.every((item) => UUID.test(string(item.userId)) && UUID.test(string(item.sessionId)) && UUID.test(string(item.requestId)));

export function finalizeM2PilotEvidence(receipt: unknown, options: { readonly outputDir: string; readonly label?: string; readonly pending?: unknown; readonly pendingPath?: string; readonly koraReceiptPath?: string; readonly manifestPath?: string }): void {
  const value = object(receipt); const output = join(options.outputDir, "PASS.json"); const temporary = `${output}.tmp`;
  try {
    if (receipt === null || typeof receipt !== "object") throw new Error("RECEIPT_MISSING");
    if (!options.manifestPath || !existsSync(options.manifestPath)) throw new Error("CYCLE7_INPUT_MANIFEST_REQUIRED");
    const inputManifest = object(JSON.parse(readFileSync(options.manifestPath, "utf8")) as unknown);
    if (inputManifest.status !== "pending") throw new Error("CYCLE7_INPUT_MANIFEST_MUST_BE_PENDING");
    if (!SHA.test(string(value.manifestDigest)) || fileDigest(options.manifestPath) !== value.manifestDigest) {
      throw new Error("CYCLE7_INPUT_MANIFEST_DIGEST_MISMATCH");
    }
    if (!options.pendingPath || resolve(options.pendingPath) !== resolve(options.outputDir, "PENDING.json")
      || !existsSync(options.pendingPath)) throw new Error("PREPARED_PENDING_REQUIRED");
    const pending = object(options.pending);
    const persistedPending = JSON.parse(readFileSync(options.pendingPath, "utf8")) as unknown;
    if (JSON.stringify(persistedPending) !== JSON.stringify(options.pending)
      || pending.contractVersion !== "archidom.m2-pilot-pending/0.2"
      || pending.status !== "MANIFEST_VALIDATED_PENDING_RUN"
      || pending.productionChanged !== false
      || pending.challengeNonce !== value.challengeNonce
      || pending.externalManifestDigest !== value.manifestDigest) throw new Error("PREPARED_PENDING_TAMPERED");
    if (existsSync(output) || value.status !== "MANIFEST_VALIDATED_PENDING_RUN" || !SHA.test(string(value.manifestDigest))) throw new Error("RECEIPT_TAMPERED");
    const executor = object(value.executor); const executorPath = string(executor.path); const absoluteExecutor = resolve(executorPath);
    const repoRelative = relative(process.cwd(), absoluteExecutor);
    const executorAllowlist = JSON.parse(readFileSync("tests/pilot-evidence/executors/allowlist.json", "utf8")) as { readonly executors?: readonly { readonly path: string; readonly digest: string }[] };
    const allowlisted = executorAllowlist.executors?.some((item) => item.path === executorPath && item.digest === executor.digest) === true;
    if (executor.repoOwned !== true || !allowlisted || repoRelative.startsWith("..") || !repoRelative.startsWith("tests/pilot-evidence/")
      || !existsSync(absoluteExecutor) || executor.digest !== fileDigest(absoluteExecutor)
      || !UUID.test(string(executor.verificationReceiptId))
      || !/^cycle7-challenge-[a-z0-9-]{6,128}$/i.test(string(value.challengeNonce))) throw new Error("RECEIPT_TAMPERED_EXECUTOR");
    const receiptBinding = object(value.pendingBinding); const pendingBinding = object(pending.pendingBinding);
    if (receiptBinding.executorPath !== pendingBinding.executorPath || receiptBinding.executorDigest !== pendingBinding.executorDigest
      || receiptBinding.executorVerificationReceiptId !== pendingBinding.executorVerificationReceiptId
      || receiptBinding.koraReceiptDigest !== pendingBinding.koraReceiptDigest
      || pendingBinding.executorPath !== executor.path || pendingBinding.executorDigest !== executor.digest
      || pendingBinding.executorVerificationReceiptId !== executor.verificationReceiptId) throw new Error("RECEIPT_TAMPERED_EXECUTOR_BINDING");
    const scope = object(value.scope);
    for (const key of ["organizationId", "projectId", "packageId"] as const) if (!UUID.test(string(scope[key]))) throw new Error("RECEIPT_TAMPERED_SCOPE");
    const sessions = list(value.sessions); const fiveDistinctUsers = new Set(sessions.map((item) => string(item.userId))).size === 5;
    if (!validFiveSessions(sessions)) throw new Error("RECEIPT_TAMPERED_SESSIONS");
    const sessionBindings = new Set(sessions.map((item) => `${item.userId}:${item.sessionId}`));
    const commands = list(value.commands); const commandIds = new Set(commands.map((item) => string(item.commandId)));
    const stateRevisions = commands.map((item) => [item.previousStateRevision, item.resultingStateRevision]);
    if (commands.length !== operations.length || commandIds.size !== operations.length
      || operations.some((operation) => !commands.some((item) => item.operation === operation))
      || commands.some((item, index) => !UUID.test(string(item.commandId)) || !UUID.test(string(item.requestId))
        || !UUID.test(string(item.auditEventId)) || !sessionBindings.has(`${item.actorUserId}:${item.actorSessionId}`)
        || item.organizationId !== scope.organizationId || item.projectId !== scope.projectId || item.packageId !== scope.packageId
        || !Number.isSafeInteger(item.previousStateRevision) || !Number.isSafeInteger(item.resultingStateRevision)
        || item.resultingStateRevision !== Number(item.previousStateRevision) + 1
        || (index > 0 && item.previousStateRevision !== commands[index - 1]!.resultingStateRevision)
        || !SHA.test(string(item.resultDigest)) || item.resultDigest !== item.replayDigest || item.replayEqual !== true)) {
      void stateRevisions; throw new Error("RECEIPT_TAMPERED_COMMAND_REPLAY");
    }
    const lineage = object(value.lineage);
    for (const key of ["submissionId", "reviewId", "approvedCommitId", "clientSubmissionId", "handoffId", "handoffApprovedCommitId"] as const) {
      if (!ENTITY_ID.test(string(lineage[key]))) throw new Error("RECEIPT_TAMPERED_LINEAGE");
    }
    for (const key of ["submissionRevisionId", "reviewRevisionId", "approvedCommitRevisionId", "clientReviewRevisionId", "handoffRevisionId", "handoffApprovedCommitRevisionId"] as const) {
      if (!UUID.test(string(lineage[key]))) throw new Error("RECEIPT_TAMPERED_LINEAGE");
    }
    if (lineage.clientSubmissionId !== lineage.submissionId || lineage.clientReviewRevisionId !== lineage.reviewRevisionId
      || lineage.handoffApprovedCommitId !== lineage.approvedCommitId || lineage.handoffApprovedCommitRevisionId !== lineage.approvedCommitRevisionId) throw new Error("RECEIPT_TAMPERED_LINEAGE");
    const proofs = object(value.proofs);
    for (const key of ["audit", "authenticatedRead", "privacy", "tenancy", "replay"] as const) {
      const proof = object(proofs[key]);
      if (!UUID.test(string(proof.queryReceiptId)) || !UUID.test(string(proof.auditReceiptId)) || !SHA.test(string(proof.digest))) throw new Error("RECEIPT_TAMPERED_PROOF");
    }
    const runFiveSessions = object(value.runFiveSessions);
    let protectedKoraReceipt = runFiveSessions;
    const boundKoraPath = string(pendingBinding.koraReceiptPath);
    if (boundKoraPath) {
      if (!options.koraReceiptPath || resolve(options.koraReceiptPath) !== resolve(boundKoraPath)
        || !existsSync(options.koraReceiptPath) || fileDigest(options.koraReceiptPath) !== pendingBinding.koraReceiptDigest) throw new Error("KORA_RECEIPT_STALE_OR_REPLACED");
      protectedKoraReceipt = object(JSON.parse(readFileSync(options.koraReceiptPath, "utf8")));
    }
    const koraSessions = list(protectedKoraReceipt.sessions);
    const producer = object(runFiveSessions.producer); const producerPath = string(producer.path); const producerAbsolute = resolve(producerPath);
    const producerRelative = relative(process.cwd(), producerAbsolute);
    const producerAllowlisted = executorAllowlist.executors?.some((item) => item.path === producerPath && item.digest === producer.digest) === true;
    const producerClaimPresent = Object.keys(producer).length > 0;
    const boundProducerPath = string(pendingBinding.koraProducerPath); const boundProducerAbsolute = resolve(boundProducerPath);
    const boundProducerAllowed = executorAllowlist.executors?.some((item) => item.path === boundProducerPath && item.digest === pendingBinding.koraProducerDigest) === true;
    if (protectedKoraReceipt.marker !== "RUN_FIVE_REQUEST_BOUND_SESSIONS" || !UUID.test(string(protectedKoraReceipt.receiptId))
      || !SHA.test(string(pendingBinding.koraReceiptDigest)) || pendingBinding.koraReceiptId !== protectedKoraReceipt.receiptId
      || !boundProducerAllowed || !existsSync(boundProducerAbsolute) || pendingBinding.koraProducerDigest !== fileDigest(boundProducerAbsolute)
      || pendingBinding.koraChallengeNonce !== value.challengeNonce
      || (producerClaimPresent && (producer.repoOwned !== true || !producerAllowlisted || producerRelative.startsWith("..")
        || !producerRelative.startsWith("tests/pilot-evidence/") || !existsSync(producerAbsolute) || producer.digest !== fileDigest(producerAbsolute)
        || producer.challengeNonce !== value.challengeNonce || pendingBinding.koraProducerPath !== producer.path
        || pendingBinding.koraProducerDigest !== producer.digest))
      || !validFiveSessions(koraSessions)) throw new Error("RECEIPT_TAMPERED_FIVE_SESSIONS");
    if (privateData.test(JSON.stringify(value))) throw new Error("RECEIPT_TAMPERED_PRIVACY");
    const runtimeReceipt = { status: "completed", verdict: "EXTERNAL_REAL_PACKAGE_PASS", label: options.label ?? null,
      headSha: currentHeadSha(), executedAt: new Date().toISOString(),
      markers: ["KORA_LOCAL_AUTHENTICATED_PASS", "EXTERNAL_REAL_PACKAGE_PASS"],
      manifestDigest: value.manifestDigest, fiveDistinctUsers, commandIds: [...commandIds], stateRevisions,
      lineage: { submission: lineage.submissionId, review: lineage.reviewId, approvedCommit: lineage.approvedCommitId, handoff: lineage.handoffId },
      executor: { digest: executor.digest, verificationReceiptId: executor.verificationReceiptId },
      koraRun: { receiptId: protectedKoraReceipt.receiptId, digest: pendingBinding.koraReceiptDigest },
      gates: { koraAuthenticatedFiveRole: true, externalRealPackage: true, audit: true, authenticatedRead: true, privacy: true, tenancy: true, replay: true },
      proofs: { audit: true, authenticatedRead: true, privacy: true, tenancy: true, replay: true } };
    if (privateData.test(JSON.stringify(runtimeReceipt))) throw new Error("RUNTIME_RECEIPT_PRIVACY");
    writeFileSync(temporary, JSON.stringify(runtimeReceipt, null, 2), { flag: "wx", mode: 0o600 });
    renameSync(temporary, output); // atomic publication
  } catch (error) {
    rmSync(temporary, { force: true }); rmSync(output, { force: true });
    throw error;
  }
}

export async function runPilotExecutor(input: { readonly executorPath: string; readonly challengeNonce: string; readonly outputDir: string; readonly manifestPath?: string; readonly executorVerificationReceiptId?: string; readonly koraReceiptDigest?: string; readonly koraReceiptId?: string; readonly koraProducerPath?: string; readonly koraProducerDigest?: string }): Promise<void> {
  const failurePath = join(input.outputDir, "FAILURE.json"); const passPath = join(input.outputDir, "PASS.json"); const temporary = `${passPath}.tmp`;
  rmSync(failurePath, { force: true }); rmSync(passPath, { force: true }); rmSync(temporary, { force: true });
  await new Promise<void>((resolvePromise, rejectPromise) => {
    execFile(input.executorPath, [input.challengeNonce, join(input.outputDir, "RECEIPT.json"), ...(input.manifestPath ? [input.manifestPath] : []), ...(input.executorVerificationReceiptId ? [input.executorVerificationReceiptId] : []), ...(input.koraReceiptDigest ? [input.koraReceiptDigest] : []), ...(input.koraReceiptId ? [input.koraReceiptId] : []), ...(input.koraProducerPath ? [input.koraProducerPath] : []), ...(input.koraProducerDigest ? [input.koraProducerDigest] : [])], { encoding: "utf8", maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) { resolvePromise(); return; }
      rmSync(passPath, { force: true }); rmSync(temporary, { force: true });
      const detail = redact(`${stdout}\n${stderr}`) || "[REDACTED]";
      const safeDiagnostics = detail.match(
        /EXTERNAL_RUNNER_(?:PREFLIGHT_STATE \{"workflowRevision"\s*:\s*\d+, "layoutRevisions"\s*:\s*\d+, "commandRecords"\s*:\s*\d+\}|REVIEW_PREREQUISITES \{"approvalEvents":\[(?:\{"sequence":\d+,"toStatus":"[a-z_]+","selfApproved":(?:true|false)\},?)*\],"submissionCount":\d+,"approvedNonSelfCount":\d+,"approvedAssignedClientCount":\d+,"approvedPackageClientActorCount":\d+\}|REVIEW_AFTER_SUBMIT \{"submissionPresent":(?:true|false),"submissionRevisionCurrent":(?:true|false),"assignedClientDistinct":(?:true|false),"approvalPackageRequired":(?:true|false),"chosenVariantPresent":(?:true|false),"chosenBudgetClean":(?:true|false)\}|EXIT stage=[A-Za-z0-9_]+ status=\d+|COMMAND_HTTP operation=[A-Za-z0-9_]+ status=(?:\d{3}|transport_failure) code=[A-Za-z0-9_]+(?: reason=[A-Za-z0-9_]{1,80})? command_id=(?:[0-9a-f-]{36}|unknown)|PROJECT_READ_HTTP role=[A-Za-z0-9_]+ status=(?:\d{3}|transport_failure) code=[A-Za-z0-9_]+|PROJECT_READ_INVALID role=[A-Za-z0-9_]+ summary=\{"status"[^\n]*\}|RESPONSE_INVALID operation=[A-Za-z0-9_]+ phase=(?:first|replay) summary=\{"status"[^\n]*\}|DB_COMMAND_MISSING operation=[A-Za-z0-9_]+|DB_COMMAND_INVALID operation=[A-Za-z0-9_]+ field=[A-Za-z0-9_]+)/g,
      ) ?? [];
      if (safeDiagnostics.length > 0) process.stderr.write(`CYCLE7_EXTERNAL_DIAGNOSTIC ${safeDiagnostics.join(" ")}\n`);
      writeFileSync(failurePath, JSON.stringify({ status: "executor_failed", detail: detail.includes("[REDACTED]") ? detail : `[REDACTED] ${detail}` }), { mode: 0o600 });
      rejectPromise(new Error("CYCLE7_EXTERNAL_EXECUTOR_FAILED"));
    });
  });
}
