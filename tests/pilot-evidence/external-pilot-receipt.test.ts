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

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const sha = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const uuid = (index: number) => `88000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const NONCE = "cycle7-challenge-3d41f7ae90bc";
const EXECUTOR_PATH = "tests/pilot-evidence/executors/external-package-runner.zsh";
const ALLOWLISTED = "tests/pilot-evidence/executors/pending-external-system.zsh";

function workdir() { const root = mkdtempSync(join(tmpdir(), "cycle7-external-")); roots.push(root); return root; }

function manifestFile(dir: string) {
  const path = join(dir, "external-manifest.json");
  writeFileSync(path, JSON.stringify({ synthetic: false, project: { name: "External venue" } }));
  return path;
}

function harvest(overrides: Record<string, any> = {}) {
  const scope = { organizationId: uuid(1), projectId: uuid(2), packageId: uuid(3) };
  const sessions = EXTERNAL_RUN_ROLES.map((role, index) => ({
    role, userId: uuid(10 + index), sessionId: uuid(20 + index), requestId: uuid(30 + index),
  }));
  const commands = EXTERNAL_RUN_OPERATIONS.map((operation, index) => ({
    operation, commandId: uuid(40 + index), requestId: uuid(50 + index), auditEventId: uuid(60 + index),
    actorUserId: sessions[Math.min(index, 2)]!.userId, actorSessionId: sessions[Math.min(index, 2)]!.sessionId,
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
  const proofs = Object.fromEntries(
    ["audit", "authenticatedRead", "privacy", "tenancy", "replay"].map((key, index) => [key,
      { queryReceiptId: uuid(80 + index), auditReceiptId: uuid(90 + index), digest: sha(`proof-${index}`) }]));
  return { scope, sessions, commands, lineage, proofs, ...overrides };
}

function input(dir: string, overrides: Record<string, any> = {}) {
  return {
    challengeNonce: NONCE,
    manifestPath: manifestFile(dir),
    executor: { path: EXECUTOR_PATH, digest: sha("executor-source"), verificationReceiptId: uuid(5) },
    kora: {
      receiptId: uuid(6), receiptDigest: sha("kora-receipt"),
      producerPath: "tests/pilot-evidence/executors/kora-five-session-producer.zsh",
      producerDigest: sha("producer-source"),
    },
    harvest: harvest(),
    ...overrides,
  } as any;
}

describe("External pilot receipt builder", () => {
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

  it("refuses sessions that are missing a role, reused or not RFC-4122", () => {
    const dir = workdir();
    const missing = harvest(); missing.sessions = missing.sessions.slice(0, 4);
    expect(() => buildExternalPilotReceipt(input(dir, { harvest: missing })))
      .toThrow("EXTERNAL_RUN_FIVE_SESSIONS_REQUIRED");
    const reused = harvest();
    reused.sessions[4] = { ...reused.sessions[4]!, sessionId: reused.sessions[0]!.sessionId };
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

  it("produces a receipt the real finalizer publishes as PASS", () => {
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

    const receipt = buildExternalPilotReceipt({
      challengeNonce: NONCE, manifestPath,
      executor: { path: ALLOWLISTED, digest: executorDigest, verificationReceiptId },
      kora: { receiptId: koraReceipt.receiptId, receiptDigest: koraReceiptDigest, producerPath: ALLOWLISTED, producerDigest: executorDigest },
      harvest: harvest(),
    });

    const pendingPath = join(dir, "PENDING.json");
    const pending = prepareM2PilotEvidence({
      outputPath: pendingPath, challengeNonce: NONCE,
      manifestDigest: (receipt as any).manifestDigest,
      executor: { path: ALLOWLISTED, digest: executorDigest, verificationReceiptId },
      koraReceipt: koraReceipt as unknown as Record<string, unknown>,
      koraReceiptPath, koraReceiptDigest,
      koraProducerPath: ALLOWLISTED, koraProducerDigest: executorDigest,
    });

    finalizeM2PilotEvidence(receipt, {
      outputDir: dir, pending, pendingPath, koraReceiptPath, label: "External real package",
    });

    const pass = JSON.parse(readFileSync(join(dir, "PASS.json"), "utf8"));
    expect(pass.verdict).toBe("EXTERNAL_REAL_PACKAGE_PASS");
    expect(pass.fiveDistinctUsers).toBe(true);
    expect(pass.commandIds).toHaveLength(EXTERNAL_RUN_OPERATIONS.length);
  });
});

describe("External package runner executable", () => {
  const shell = () => readFileSync(EXECUTOR_PATH, "utf8");

  it("exists, is executable and is not allowlisted until reviewed", () => {
    expect(existsSync(EXECUTOR_PATH)).toBe(true);
    expect(statSync(EXECUTOR_PATH).mode & 0o111).not.toBe(0);
    const allowlist = JSON.parse(readFileSync("tests/pilot-evidence/executors/allowlist.json", "utf8"));
    expect(allowlist.executors.some((entry: any) => entry.path === EXECUTOR_PATH)).toBe(false);
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
