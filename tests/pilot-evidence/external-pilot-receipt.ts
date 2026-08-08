import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

// The exact operation chain the external package must be driven through, in the
// order the workflow performs them. The finalizer requires all five and rejects
// a state-revision chain that does not run consecutively across this array.
export const EXTERNAL_RUN_OPERATIONS = [
  "publish_m2_layout_version",
  "submit_m2_client_review",
  "review_m2_client_submission",
  "append_m2_approved_commit_revision",
  "publish_m2_m3_handoff",
] as const;

export const EXTERNAL_RUN_ROLES = [
  "owner_lead", "architect", "client_approver", "builder", "guest",
] as const;

const PROOF_KEYS = ["audit", "authenticatedRead", "privacy", "tenancy", "replay"] as const;
const LINEAGE_ENTITY_KEYS = [
  "submissionId", "reviewId", "approvedCommitId",
  "clientSubmissionId", "handoffId", "handoffApprovedCommitId",
] as const;
const LINEAGE_REVISION_KEYS = [
  "submissionRevisionId", "reviewRevisionId", "approvedCommitRevisionId",
  "clientReviewRevisionId", "handoffRevisionId", "handoffApprovedCommitRevisionId",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const CHALLENGE_NONCE = /^cycle7-challenge-[a-z0-9-]{6,128}$/i;
const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/;
const EXECUTORS_PREFIX = "tests/pilot-evidence/executors/";
const PRIVATE_DATA = /sk-[a-z0-9_-]+|sbp_token|refresh_token|\/Users\/|\/Volumes\/|\/mnt\/|\.\.\/|bearer\s+\S+/i;

export interface ExternalRunSession {
  readonly role: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly requestId: string;
}

export interface ExternalRunCommand {
  readonly operation: string;
  readonly commandId: string;
  readonly requestId: string;
  readonly auditEventId: string;
  readonly actorUserId: string;
  readonly actorSessionId: string;
  readonly previousStateRevision: number;
  readonly resultingStateRevision: number;
  readonly resultDigest: string;
  readonly replayDigest: string;
}

export interface BuildExternalPilotReceiptInput {
  readonly challengeNonce: string;
  readonly manifestPath: string;
  readonly executor: { readonly path: string; readonly digest: string; readonly verificationReceiptId: string };
  readonly kora: {
    readonly receiptId: string; readonly receiptDigest: string;
    readonly producerPath: string; readonly producerDigest: string;
  };
  readonly harvest: {
    readonly scope: Readonly<Record<string, unknown>>;
    readonly sessions: readonly Readonly<Record<string, unknown>>[];
    readonly commands: readonly Readonly<Record<string, unknown>>[];
    readonly lineage: Readonly<Record<string, unknown>>;
    readonly proofs: Readonly<Record<string, unknown>>;
  };
}

const text = (value: unknown): string => typeof value === "string" ? value : "";
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(record) : [];

function fail(code: string): never { throw new Error(code); }

function harvestScope(raw: Record<string, unknown>): { organizationId: string; projectId: string; packageId: string } {
  const scope = {
    organizationId: text(raw.organizationId),
    projectId: text(raw.projectId),
    packageId: text(raw.packageId),
  };
  if (Object.values(scope).some((value) => !UUID.test(value))) fail("EXTERNAL_RUN_SCOPE_INVALID");
  return scope;
}

function harvestSessions(raw: readonly Record<string, unknown>[]): ExternalRunSession[] {
  if (raw.length !== EXTERNAL_RUN_ROLES.length) fail("EXTERNAL_RUN_FIVE_SESSIONS_REQUIRED");
  const sessions = EXTERNAL_RUN_ROLES.map((role) => {
    const found = raw.filter((item) => item.role === role);
    if (found.length !== 1) fail("EXTERNAL_RUN_FIVE_SESSIONS_REQUIRED");
    const session: ExternalRunSession = {
      role,
      userId: text(found[0]!.userId),
      sessionId: text(found[0]!.sessionId),
      requestId: text(found[0]!.requestId),
    };
    if (!UUID.test(session.userId) || !UUID.test(session.sessionId) || !UUID.test(session.requestId)) {
      fail("EXTERNAL_RUN_SESSION_IDENTIFIER_INVALID");
    }
    return session;
  });
  for (const field of ["userId", "sessionId", "requestId"] as const) {
    if (new Set(sessions.map((session) => session[field])).size !== sessions.length) {
      fail("EXTERNAL_RUN_SESSION_IDENTIFIER_NOT_DISTINCT");
    }
  }
  return sessions;
}

function harvestCommands(
  raw: readonly Record<string, unknown>[],
  sessions: readonly ExternalRunSession[],
  scope: { organizationId: string; projectId: string; packageId: string },
): (ExternalRunCommand & typeof scope & { replayEqual: true })[] {
  if (raw.length !== EXTERNAL_RUN_OPERATIONS.length) fail("EXTERNAL_RUN_OPERATION_CHAIN_REQUIRED");
  const bindings = new Set(sessions.map((session) => `${session.userId}:${session.sessionId}`));
  const commands = raw.map((item, index) => {
    if (item.operation !== EXTERNAL_RUN_OPERATIONS[index]) fail("EXTERNAL_RUN_OPERATION_CHAIN_REQUIRED");
    const number = (value: unknown): number => typeof value === "number" ? value : Number.NaN;
    const command = {
      operation: EXTERNAL_RUN_OPERATIONS[index]!,
      commandId: text(item.commandId),
      requestId: text(item.requestId),
      auditEventId: text(item.auditEventId),
      actorUserId: text(item.actorUserId),
      actorSessionId: text(item.actorSessionId),
      ...scope,
      previousStateRevision: number(item.previousStateRevision),
      resultingStateRevision: number(item.resultingStateRevision),
      resultDigest: text(item.resultDigest),
      replayDigest: text(item.replayDigest),
      replayEqual: true as const,
    };
    if (!UUID.test(command.commandId) || !UUID.test(command.requestId) || !UUID.test(command.auditEventId)) {
      fail("EXTERNAL_RUN_COMMAND_IDENTIFIER_INVALID");
    }
    if (!bindings.has(`${command.actorUserId}:${command.actorSessionId}`)) fail("EXTERNAL_RUN_COMMAND_ACTOR_UNBOUND");
    if (!Number.isSafeInteger(command.previousStateRevision) || !Number.isSafeInteger(command.resultingStateRevision)
      || command.resultingStateRevision !== command.previousStateRevision + 1) {
      fail("EXTERNAL_RUN_STATE_REVISION_INVALID");
    }
    // A replay that returned a different result is not a replay proof. The
    // executor must send the exact command twice and compare, not assert.
    if (!SHA256.test(command.resultDigest) || command.resultDigest !== command.replayDigest) {
      fail("EXTERNAL_RUN_REPLAY_NOT_PROVEN");
    }
    return command;
  });
  for (let index = 1; index < commands.length; index += 1) {
    if (commands[index]!.previousStateRevision !== commands[index - 1]!.resultingStateRevision) {
      fail("EXTERNAL_RUN_STATE_REVISION_NOT_CHAINED");
    }
  }
  if (new Set(commands.map((command) => command.commandId)).size !== commands.length) {
    fail("EXTERNAL_RUN_COMMAND_IDENTIFIER_NOT_DISTINCT");
  }
  return commands;
}

function harvestLineage(raw: Record<string, unknown>): Record<string, string> {
  const lineage: Record<string, string> = {};
  for (const key of LINEAGE_ENTITY_KEYS) {
    lineage[key] = text(raw[key]);
    if (!ENTITY_ID.test(lineage[key]!)) fail("EXTERNAL_RUN_LINEAGE_INVALID");
  }
  for (const key of LINEAGE_REVISION_KEYS) {
    lineage[key] = text(raw[key]);
    if (!UUID.test(lineage[key]!)) fail("EXTERNAL_RUN_LINEAGE_INVALID");
  }
  // The client submission and the designer submission are the same entity, and
  // the handoff must carry the very commit that was approved.
  if (lineage.clientSubmissionId !== lineage.submissionId
    || lineage.clientReviewRevisionId !== lineage.reviewRevisionId
    || lineage.handoffApprovedCommitId !== lineage.approvedCommitId
    || lineage.handoffApprovedCommitRevisionId !== lineage.approvedCommitRevisionId) {
    fail("EXTERNAL_RUN_LINEAGE_NOT_LINKED");
  }
  return lineage;
}

function harvestProofs(raw: Record<string, unknown>): Record<string, unknown> {
  const proofs: Record<string, unknown> = {};
  for (const key of PROOF_KEYS) {
    const proof = record(raw[key]);
    const value = {
      queryReceiptId: text(proof.queryReceiptId),
      auditReceiptId: text(proof.auditReceiptId),
      digest: text(proof.digest),
    };
    if (!UUID.test(value.queryReceiptId) || !UUID.test(value.auditReceiptId) || !SHA256.test(value.digest)) {
      fail("EXTERNAL_RUN_PROOF_INVALID");
    }
    proofs[key] = value;
  }
  return proofs;
}

export function buildExternalPilotReceipt(input: BuildExternalPilotReceiptInput): Record<string, unknown> {
  const challengeNonce = text(input.challengeNonce);
  if (!CHALLENGE_NONCE.test(challengeNonce)) fail("EXTERNAL_RUN_CHALLENGE_NONCE_INVALID");
  const executorPath = text(input.executor.path);
  if (!executorPath.startsWith(EXECUTORS_PREFIX) || executorPath.split("/").includes("..")
    || !SHA256.test(text(input.executor.digest)) || !UUID.test(text(input.executor.verificationReceiptId))) {
    fail("EXTERNAL_RUN_EXECUTOR_IDENTITY_INVALID");
  }
  const producerPath = text(input.kora.producerPath);
  if (!producerPath.startsWith(EXECUTORS_PREFIX) || producerPath.split("/").includes("..")
    || !SHA256.test(text(input.kora.producerDigest)) || !SHA256.test(text(input.kora.receiptDigest))
    || !UUID.test(text(input.kora.receiptId))) {
    fail("EXTERNAL_RUN_KORA_BINDING_INVALID");
  }

  const scope = harvestScope(record(input.harvest.scope));
  const sessions = harvestSessions(list(input.harvest.sessions));
  const commands = harvestCommands(list(input.harvest.commands), sessions, scope);
  const lineage = harvestLineage(record(input.harvest.lineage));
  const proofs = harvestProofs(record(input.harvest.proofs));

  const receipt = {
    status: "MANIFEST_VALIDATED_PENDING_RUN" as const,
    challengeNonce,
    manifestDigest: `sha256:${createHash("sha256").update(readFileSync(input.manifestPath)).digest("hex")}`,
    executor: {
      path: executorPath,
      digest: input.executor.digest,
      repoOwned: true as const,
      verificationReceiptId: input.executor.verificationReceiptId,
    },
    scope,
    sessions,
    commands,
    lineage,
    proofs,
    runFiveSessions: {
      receiptId: input.kora.receiptId,
      producer: {
        path: producerPath,
        digest: input.kora.producerDigest,
        challengeNonce,
        repoOwned: true as const,
      },
    },
    pendingBinding: {
      executorPath,
      executorDigest: input.executor.digest,
      executorVerificationReceiptId: input.executor.verificationReceiptId,
      koraReceiptDigest: input.kora.receiptDigest,
    },
  };

  if (PRIVATE_DATA.test(JSON.stringify(receipt))) fail("EXTERNAL_RUN_RECEIPT_PRIVACY");
  return receipt;
}

export function writeExternalPilotReceipt(receipt: Record<string, unknown>, path: string): void {
  writeFileSync(path, JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
}
