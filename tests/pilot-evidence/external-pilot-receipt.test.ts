/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial harvest mutations intentionally cross the runtime trust boundary */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXTERNAL_RUN_OPERATIONS,
  EXTERNAL_RUN_ROLES,
  buildExternalPilotReceipt,
  writeExternalPilotReceipt,
} from "./external-pilot-receipt";
import { buildKoraFiveSessionReceipt, writeKoraFiveSessionReceipt } from "./kora-five-session-receipt";
import { finalizeM2PilotEvidence } from "./finalize-m2-pilot-evidence";
import { prepareM2PilotEvidence } from "./run-m2-pilot-evidence";
import { buildExternalProofFixture } from "./proof-fixture";
import { canonicalJson } from "../../lib/project-intelligence/application/change-handoff/canonical";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const sha = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const uuid = (index: number) => `88000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const NONCE = "cycle7-challenge-3d41f7ae90bc";
const EXECUTOR_PATH = "tests/pilot-evidence/executors/external-package-runner.zsh";
const ALLOWLISTED = "tests/pilot-evidence/executors/pending-external-system.zsh";
const commandRoles = ["owner_lead", "owner_lead", "client_approver", "client_approver", "owner_lead"] as const;
const MANIFEST_JSON = readFileSync("tests/fixtures/cycle7/external-package.manifest.json", "utf8");
const MANIFEST_SCOPE = (JSON.parse(MANIFEST_JSON) as { scope: {
  organizationId: string; projectId: string; packageId: string;
} }).scope;
const MANIFEST_DIGEST = sha(MANIFEST_JSON);

function workdir() { const root = mkdtempSync(join(tmpdir(), "cycle7-external-")); roots.push(root); return root; }

it("keeps the runner operation role in the protected harvest", () => {
  const runner = readFileSync(EXECUTOR_PATH, "utf8");
  expect(runner).toContain("commands: $commands[0]");
  expect(runner).not.toContain("commands: [$commands[0][] | del(.role)]");
});

function manifestFile(dir: string) {
  const path = join(dir, "external-manifest.json");
  writeFileSync(path, MANIFEST_JSON);
  return path;
}

function harvest(overrides: Record<string, any> = {}) {
  const scope = { organizationId: MANIFEST_SCOPE.organizationId, projectId: MANIFEST_SCOPE.projectId,
    packageId: MANIFEST_SCOPE.packageId };
  const sessions = EXTERNAL_RUN_ROLES.map((role, index) => {
    const sessionId = uuid(20 + index);
    return { role, userId: uuid(10 + index), sessionId, requestId: uuid(30 + index), serverSessionDigest: sha(sessionId) };
  });
  const commands = EXTERNAL_RUN_OPERATIONS.map((operation, index) => ({ role: commandRoles[index]!,
    replayMode: index === 3 ? "parent_atomic_side_effect" : "direct",
    operation, commandId: uuid(40 + index), requestId: uuid(index === 3 ? 52 : 50 + index), auditEventId: uuid(60 + index),
    actorUserId: sessions.find((session) => session.role === commandRoles[index])!.userId,
    actorSessionId: sessions.find((session) => session.role === commandRoles[index])!.sessionId,
    actorSessionDigest: sessions.find((session) => session.role === commandRoles[index])!.serverSessionDigest,
    previousStateRevision: 200 + index, resultingStateRevision: 201 + index,
    resultDigest: sha(`result-${index}`), replayDigest: sha(`result-${index}`),
  }));
  const lineage = {
    submissionId: "submission-external-room", submissionRevisionId: uuid(70),
    reviewId: "review-external-room", reviewRevisionId: uuid(71),
    approvedCommitId: "approved-external-room", approvedCommitRevisionId: uuid(72),
    clientSubmissionId: "submission-external-room", clientReviewRevisionId: uuid(71),
    handoffId: "handoff-external-room", handoffRevisionId: uuid(73),
    handoffApprovedCommitId: "approved-external-room", handoffApprovedCommitRevisionId: uuid(72),
  };
  const proofs = buildExternalProofFixture({
    scope, commands, manifestDigest: MANIFEST_DIGEST, challengeNonce: NONCE, uuid, sha: (value) => sha(value),
  });
  return { scope, sessions, commands, lineage, proofs, ...overrides };
}

function input(dir: string, overrides: Record<string, any> = {}) {
  const manifestPath = manifestFile(dir);
  const run = harvest();
  return {
    challengeNonce: NONCE,
    manifestPath,
    executor: { path: EXECUTOR_PATH, digest: sha("executor-source"), verificationReceiptId: uuid(5) },
    kora: {
      receiptId: uuid(6), receiptDigest: sha("kora-receipt"),
      producerPath: "tests/pilot-evidence/executors/kora-five-session-producer.zsh",
      producerDigest: sha("producer-source"),
    },
    harvest: run,
    ...overrides,
  } as any;
}

describe("External pilot receipt builder", () => {
  it("preserves distinct database audit and HTTP request identities", () => {
    const run = harvest() as any;
    for (const [index, command] of run.commands.entries()) {
      command.auditRequestId = `db:${uuid(900 + index)}`;
      run.proofs.audit.source[index].requestId = command.auditRequestId;
    }
    run.proofs.audit.queryRequestId = run.commands[0].auditRequestId;
    run.proofs.audit.resultDigest = sha(canonicalJson(run.proofs.audit.source));
    const receipt = buildExternalPilotReceipt(input(workdir(), { harvest: run })) as any;
    expect(receipt.commands[3].requestId).toBe(run.commands[2].requestId);
    expect(receipt.commands[3].auditRequestId).toBe(run.commands[3].auditRequestId);
    expect(receipt.proofs.audit.source).toEqual(run.proofs.audit.source);
    const tampered = structuredClone(run);
    tampered.proofs.audit.source[3].requestId = `db:${uuid(998)}`;
    tampered.proofs.audit.resultDigest = sha(canonicalJson(tampered.proofs.audit.source));
    expect(() => buildExternalPilotReceipt(input(workdir(), { harvest: tampered })))
      .toThrow("EXTERNAL_RUN_PROOF_SOURCE_INVALID");
    run.commands[3].requestId = uuid(999);
    expect(() => buildExternalPilotReceipt(input(workdir(), { harvest: run })))
      .toThrow("EXTERNAL_RUN_SIDE_EFFECT_NOT_BOUND");
  });
  it("keeps jq canonical proof bytes identical to TypeScript canonicalJson", () => {
    const value = { requestId: uuid(777), forbiddenFieldCount: 0 };
    const jq = spawnSync("jq", ["-cSj", "."], { input: JSON.stringify(value), encoding: "utf8" });
    expect(jq.status).toBe(0);
    expect(jq.stdout).toBe(canonicalJson(value));
    expect(sha(jq.stdout)).toBe(sha(canonicalJson(value)));
  });

  it("emits the exact shape the finalizer reads, with scope stamped on every command", () => {
    const dir = workdir();
    const receipt = buildExternalPilotReceipt(input(dir)) as any;
    expect(receipt.status).toBe("MANIFEST_VALIDATED_PENDING_RUN");
    expect(receipt.executor.repoOwned).toBe(true);
    expect(receipt.manifestDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(receipt.commands.map((command: any) => command.operation)).toEqual([...EXTERNAL_RUN_OPERATIONS]);
    for (const command of receipt.commands) {
      expect(command.replayEqual).toBe(true);
      expect(command.organizationId).toBe(receipt.scope.organizationId);
      expect(command.packageId).toBe(receipt.scope.packageId);
    }
    expect(receipt.sessions.map((session: any) => session.role)).toEqual([...EXTERNAL_RUN_ROLES]);
  });

  it("requires the five operations in workflow order", () => {
    const dir = workdir();
    const reordered = harvest();
    [reordered.commands[0], reordered.commands[1]] = [reordered.commands[1]!, reordered.commands[0]!];
    expect(() => buildExternalPilotReceipt(input(dir, { harvest: reordered })))
      .toThrow("EXTERNAL_RUN_OPERATION_CHAIN_REQUIRED");
    const short = harvest(); short.commands = short.commands.slice(0, 4);
    expect(() => buildExternalPilotReceipt(input(dir, { harvest: short })))
      .toThrow("EXTERNAL_RUN_OPERATION_CHAIN_REQUIRED");
  });

  it("refuses a replay whose second result differed — that is not a replay proof", () => {
    const dir = workdir();
    const drifted = harvest();
    drifted.commands[2] = { ...drifted.commands[2]!, replayDigest: sha("something-else") };
    expect(() => buildExternalPilotReceipt(input(dir, { harvest: drifted })))
      .toThrow("EXTERNAL_RUN_REPLAY_NOT_PROVEN");
  });

  it("refuses a state revision chain that skips, repeats or runs backwards", () => {
    const dir = workdir();
    const gap = harvest();
    gap.commands[3] = { ...gap.commands[3]!, previousStateRevision: 900, resultingStateRevision: 901 };
    expect(() => buildExternalPilotReceipt(input(dir, { harvest: gap })))
      .toThrow("EXTERNAL_RUN_STATE_REVISION_NOT_CHAINED");
    const jump = harvest();
    jump.commands[1] = { ...jump.commands[1]!, resultingStateRevision: 205 };
    expect(() => buildExternalPilotReceipt(input(dir, { harvest: jump })))
      .toThrow("EXTERNAL_RUN_STATE_REVISION_INVALID");
  });

  it("refuses a command whose actor is not one of the five harvested sessions", () => {
    const dir = workdir();
    const stranger = harvest();
    stranger.commands[0] = { ...stranger.commands[0]!, actorUserId: uuid(999) };
    expect(() => buildExternalPilotReceipt(input(dir, { harvest: stranger })))
      .toThrow("EXTERNAL_RUN_COMMAND_ACTOR_UNBOUND");
  });

  it("requires five distinct typed proof receipts in the exact external scope", () => {
    const dir = workdir();
    const wrongKind = harvest();
    wrongKind.proofs.audit = { ...wrongKind.proofs.audit!, kind: "privacy" };
    expect(() => buildExternalPilotReceipt(input(dir, { harvest: wrongKind })))
      .toThrow("EXTERNAL_RUN_PROOF_INVALID");

    const duplicateRequest = harvest();
    duplicateRequest.proofs.replay = {
      ...duplicateRequest.proofs.replay!,
      queryRequestId: (duplicateRequest.proofs.audit as { queryRequestId: string }).queryRequestId,
    };
    expect(() => buildExternalPilotReceipt(input(dir, { harvest: duplicateRequest })))
      .toThrow("EXTERNAL_RUN_PROOF_NOT_DISTINCT");

    const wrongScope = harvest();
    wrongScope.proofs.tenancy = { ...wrongScope.proofs.tenancy!, packageId: uuid(999) };
    expect(() => buildExternalPilotReceipt(input(dir, { harvest: wrongScope })))
      .toThrow("EXTERNAL_RUN_PROOF_INVALID");
  });

  it("binds audit ids only to proof sources that actually contain those audit rows", () => {
    const dir = workdir();
    const swapped = harvest();
    const audit = swapped.proofs.audit as { auditEventIds: string[] };
    [audit.auditEventIds[0], audit.auditEventIds[1]] = [audit.auditEventIds[1]!, audit.auditEventIds[0]!];
    expect(() => buildExternalPilotReceipt(input(dir, { harvest: swapped })))
      .toThrow("EXTERNAL_RUN_PROOF_INVALID");

    const invented = harvest();
    (invented.proofs.authenticatedRead as { auditEventIds: string[] }).auditEventIds = [invented.commands[0]!.auditEventId];
    expect(() => buildExternalPilotReceipt(input(dir, { harvest: invented })))
      .toThrow("EXTERNAL_RUN_PROOF_INVALID");
  });

  it("refuses sessions that are missing a role, reused or not RFC-4122", () => {
    const dir = workdir();
    const missing = harvest(); missing.sessions = missing.sessions.slice(0, 4);
    expect(() => buildExternalPilotReceipt(input(dir, { harvest: missing })))
      .toThrow("EXTERNAL_RUN_FIVE_SESSIONS_REQUIRED");
    const reused = harvest();
    reused.sessions[4] = {
      ...reused.sessions[4]!,
      sessionId: reused.sessions[0]!.sessionId,
      serverSessionDigest: reused.sessions[0]!.serverSessionDigest,
    };
    expect(() => buildExternalPilotReceipt(input(dir, { harvest: reused })))
      .toThrow("EXTERNAL_RUN_SESSION_IDENTIFIER_NOT_DISTINCT");
    const malformed = harvest();
    malformed.sessions[1] = { ...malformed.sessions[1]!, userId: "not-a-uuid" };
    expect(() => buildExternalPilotReceipt(input(dir, { harvest: malformed })))
      .toThrow("EXTERNAL_RUN_SESSION_IDENTIFIER_INVALID");
  });

  it("refuses lineage that does not carry the approved commit into the handoff", () => {
    const dir = workdir();
    const broken = harvest();
    broken.lineage = { ...broken.lineage, handoffApprovedCommitId: "approved-something-else" };
    expect(() => buildExternalPilotReceipt(input(dir, { harvest: broken })))
      .toThrow("EXTERNAL_RUN_LINEAGE_NOT_LINKED");
  });

  it("refuses an executor or Kora producer identity outside the executors directory", () => {
    const dir = workdir();
    expect(() => buildExternalPilotReceipt(input(dir, {
      executor: { path: "/absolute/runner.zsh", digest: sha("x"), verificationReceiptId: uuid(5) },
    }))).toThrow("EXTERNAL_RUN_EXECUTOR_IDENTITY_INVALID");
    expect(() => buildExternalPilotReceipt(input(dir, {
      kora: { receiptId: uuid(6), receiptDigest: sha("k"), producerPath: "tests/pilot-evidence/run-m2-pilot-evidence.zsh", producerDigest: sha("p") },
    }))).toThrow("EXTERNAL_RUN_KORA_BINDING_INVALID");
  });

  it("writes the receipt read-protected and never overwrites one", () => {
    const dir = workdir();
    const path = join(dir, "RECEIPT.json");
    const receipt = buildExternalPilotReceipt(input(dir));
    writeExternalPilotReceipt(receipt, path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() => writeExternalPilotReceipt(receipt, path)).toThrow();
  });

  it("does not promote a five-command M2 receipt to full external PASS", () => {
    const dir = workdir();
    const executorDigest = sha(readFileSync(ALLOWLISTED));
    const verificationReceiptId = uuid(5);
    const manifestPath = manifestFile(dir);

    const koraReceipt = buildKoraFiveSessionReceipt({
      challengeNonce: NONCE, receiptId: uuid(6),
      producer: { path: ALLOWLISTED, digest: executorDigest },
      harvest: {
        runMarker: "AP1_SUPPORTED_SLICE_E2E_OK users=5 production_changed=false",
        sessions: Object.fromEntries(["owner", "architect", "client", "builder", "guest"].map((role, index) => [role,
          { userId: uuid(100 + index), sessionId: uuid(110 + index), requestId: uuid(120 + index) }])),
      },
    });
    const koraReceiptPath = join(dir, "KORA_RECEIPT.json");
    writeKoraFiveSessionReceipt(koraReceipt, koraReceiptPath);
    const koraReceiptDigest = sha(readFileSync(koraReceiptPath));

    const actualAuditRun = harvest() as any;
    actualAuditRun.commands.forEach((command: any, index: number) => {
      command.auditRequestId = `db:${uuid(800 + index)}`;
      actualAuditRun.proofs.audit.source[index].requestId = command.auditRequestId;
    });
    actualAuditRun.proofs.audit.queryRequestId = actualAuditRun.commands[0].auditRequestId;
    actualAuditRun.proofs.audit.resultDigest = sha(canonicalJson(actualAuditRun.proofs.audit.source));
    const receipt = buildExternalPilotReceipt({
      challengeNonce: NONCE, manifestPath,
      executor: { path: ALLOWLISTED, digest: executorDigest, verificationReceiptId },
      kora: { receiptId: koraReceipt.receiptId, receiptDigest: koraReceiptDigest, producerPath: ALLOWLISTED, producerDigest: executorDigest },
      harvest: actualAuditRun,
    }) as any;

    const pendingPath = join(dir, "PENDING.json");
    const pending = prepareM2PilotEvidence({
      outputPath: pendingPath, challengeNonce: NONCE,
      manifestDigest: (receipt as any).manifestDigest,
      executor: { path: ALLOWLISTED, digest: executorDigest, verificationReceiptId },
      koraReceipt: koraReceipt as unknown as Record<string, unknown>,
      koraReceiptPath, koraReceiptDigest,
      koraProducerPath: ALLOWLISTED, koraProducerDigest: executorDigest,
    });

    expect(() => finalizeM2PilotEvidence(receipt, {
      outputDir: dir, pending, pendingPath, koraReceiptPath, manifestPath, label: "External real package",
    })).toThrow("EXTERNAL_DELIVERY_NATIVE_M3_PROOF_REQUIRED");
    expect(existsSync(join(dir, "PASS.json"))).toBe(false);
    expect(existsSync(join(dir, "PASS.json.tmp"))).toBe(false);
  });

  it("rejects a completed input manifest before publishing a runtime receipt", () => {
    const dir = workdir();
    const manifestPath = manifestFile(dir);
    writeFileSync(manifestPath, JSON.stringify({ status: "completed" }));
    const out = join(dir, "PASS.json");
    const value = { status: "MANIFEST_VALIDATED_PENDING_RUN", manifestDigest: sha(readFileSync(manifestPath)) };
    expect(() => finalizeM2PilotEvidence(value, { outputDir: dir, manifestPath })).toThrow("CYCLE7_INPUT_MANIFEST_MUST_BE_PENDING");
    expect(existsSync(out)).toBe(false);
  });
});

describe("External package runner executable", () => {
  const shell = () => readFileSync(EXECUTOR_PATH, "utf8");

  it("exists and is executable", () => {
    expect(existsSync(EXECUTOR_PATH)).toBe(true);
    expect(statSync(EXECUTOR_PATH).mode & 0o111).not.toBe(0);
  });

  it("executes scope guards with the canonical room slug while rejecting unsafe room and scope ids", () => {
    const source = shell();
    const guard = source.slice(source.indexOf("uuid_pattern="), source.indexOf("query_db()"));
    const manifest = JSON.parse(readFileSync("tests/fixtures/cycle7/external-package.manifest.json", "utf8"));
    const run = (roomId: string, projectId = manifest.scope.projectId) => spawnSync("zsh", ["-c", guard], {
      encoding: "utf8", env: { ...process.env, requested_organization_id: manifest.scope.organizationId,
        project_id: projectId, package_id: manifest.scope.packageId, room_id: roomId },
    });
    expect(run(manifest.scope.roomId).status).toBe(0);
    for (const roomId of ["", "../room", "room' OR true", "x".repeat(161)]) {
      expect(run(roomId).status).toBe(66);
    }
    expect(run(manifest.scope.roomId, "not-a-uuid").status).toBe(66);
  });

  it("rejects raw roomId controls before command substitution can strip them", () => {
    const filter = shell().match(/room_id=\$\(manifest_jq -er '([^']+)'\)/)?.[1];
    expect(filter).toBeTruthy();
    const run = (roomId: unknown) => spawnSync("jq", ["-er", filter!], {
      input: JSON.stringify({ scope: { roomId } }), encoding: "utf8",
    });
    expect(run("tashkent-ground-floor-living-kitchen").status).toBe(0);
    for (const roomId of ["tashkent-room\n", "tashkent-room\r", "room\u0000", null, 1]) {
      expect(run(roomId).status).not.toBe(0);
    }
  });

  it("sends every command twice and compares, instead of asserting replay", () => {
    const source = shell();
    expect(source).toContain("send_command");
    expect(source).toContain("replay");
    expect(source).toMatch(/result_digest/);
    expect(source).toMatch(/replay_digest/);
  });

  it("reads audit ids and state revisions from the run, not from the manifest", () => {
    const source = shell();
    expect(source).toContain("audit_events");
    expect(source).toContain("stateRevision");
    expect(source).not.toMatch(/uuidgen[^)]*audit_event/i);
  });

  it("builds each proof from an actual query or HTTP result instead of minted proof ids", () => {
    const source = shell();
    const proofSection = source.slice(source.indexOf('proofs="${work_dir}/proofs.json"'));
    expect(proofSection).toContain("audit_snapshot");
    expect(proofSection).toContain("owner-external-workspace.json");
    expect(proofSection).toContain("guest-external-workspace.json");
    expect(proofSection).toContain("proof-replay.json");
    expect(proofSection).not.toMatch(/query_receipt=.*uuidgen/);
    expect(proofSection).not.toMatch(/select audit_event_id[^]*order by occurred_at desc limit 1/);
  });

  it("takes one manifest byte snapshot and never reopens its path for command decisions", () => {
    const source = shell();
    expect(source).toContain('manifest_snapshot_base64=$(openssl base64 -A -in "${manifest_path}")');
    expect(source).toContain("manifest_jq");
    expect(source.match(/\$\{manifest_path\}/g)).toHaveLength(3);
    expect(source.slice(source.indexOf("organization_id="))).not.toContain('jq -er \'.scope.organizationId\' "${manifest_path}"');
  });

  it("requires existing authenticated enrollment without privileged scope writes", () => {
    const source = shell();
    const bootstrap = source.slice(source.indexOf("verify_external_scope()"), source.indexOf("harvest_db_command()"));
    expect(bootstrap).toContain("enroll_organization_project_scope");
    expect(bootstrap).not.toContain("graph_nodes");
    expect(bootstrap).not.toContain("graph_node_revisions");
    expect(source.indexOf("send_command owner publish_m2_layout_version")).toBeGreaterThan(source.indexOf("verify_external_scope"));
    expect(bootstrap).not.toMatch(/\b(?:insert\s+into|update\s+project|delete\s+from)\b/i);
    expect(bootstrap).toContain("EXTERNAL_RUNNER_AUTHENTICATED_SCOPE_REQUIRED");
  });

  it("binds every role to the session_id inside its actual cookie JWT", () => {
    const source = shell();
    expect(source).toContain("cookie-session-cli.ts");
    expect(source).toContain("EXTERNAL_RUNNER_COOKIE_USER_MISMATCH");
    expect(source).toContain("where id = '${session_id}'::uuid and user_id = '${user_id}'::uuid");
    expect(source).toContain("x-archidom-auth-session-digest:");
    expect(source).toContain("serverSessionDigest");
    expect(source).toContain("EXTERNAL_RUNNER_SERVER_SESSION_MISMATCH");
    expect(source).not.toMatch(/select id from auth\.sessions where user_id[^]*order by created_at desc limit 1/);
  });

  it("refuses to start without its arguments and cleans up on failure", () => {
    const source = shell();
    expect(source).toContain("set -euo pipefail");
    expect(source).toContain("EXTERNAL_RUNNER_ARGUMENTS_REQUIRED");
    expect(source).toMatch(/trap cleanup EXIT/);
    expect(source).not.toMatch(/\blocal\s+status=/);
  });

  it("keeps the cycle 7 gate alive and out of the everyday suite", () => {
    // Разделение test / test:cycle7 не должно превратиться в тихое удаление
    // гейта: файл обязан существовать и по-прежнему требовать манифест.
    const gate = "tests/pilot-evidence/m2-pilot-external-manifest.gate.test.ts";
    expect(existsSync(gate)).toBe(true);
    expect(readFileSync(gate, "utf8")).toContain("CYCLE7_EXTERNAL_MANIFEST_REQUIRED");
    expect(readFileSync("vitest.config.ts", "utf8")).toContain("**/*.gate.test.ts");
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    expect(scripts["test:cycle7"]).toContain("vitest.cycle7.config.ts");
  });

  const zshAvailable = spawnSync("zsh", ["--version"], { encoding: "utf8" }).status === 0;
  it.skipIf(!zshAvailable)("exits non-zero and writes no receipt when called with no arguments", () => {
    const run = spawnSync("zsh", [EXECUTOR_PATH], { encoding: "utf8" });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("EXTERNAL_RUNNER_ARGUMENTS_REQUIRED");
    expect(run.stderr).not.toContain("read-only variable");
  });
});
