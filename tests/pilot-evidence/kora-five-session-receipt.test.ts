/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial harvest mutations intentionally cross the runtime trust boundary */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AP1_SESSION_BINDINGS,
  KORA_RECEIPT_MARKER,
  buildKoraFiveSessionReceipt,
  writeKoraFiveSessionReceipt,
} from "./kora-five-session-receipt";
import { finalizeM2PilotEvidence } from "./finalize-m2-pilot-evidence";
import { prepareM2PilotEvidence } from "./run-m2-pilot-evidence";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const sha = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const uuid = (index: number) => `99000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const CYCLE7_ROLES = ["owner_lead", "architect", "client_approver", "builder", "guest"];
const AP1_ROLES = ["owner", "architect", "client", "builder", "guest"];
const NONCE = "cycle7-challenge-7f0d9c2b41ae";
const PRODUCER_PATH = "tests/pilot-evidence/executors/kora-five-session-producer.zsh";
const RUN_MARKER = "AP1_SUPPORTED_SLICE_E2E_OK users=5 auth=magiclink area_m2=1800 replay=true production_changed=false";

function outputDir() { const root = mkdtempSync(join(tmpdir(), "cycle7-kora-receipt-")); roots.push(root); return root; }

function harvest(overrides: Record<string, any> = {}) {
  const sessions = Object.fromEntries(AP1_ROLES.map((role, index) => [role, {
    userId: uuid(10 + index), sessionId: uuid(20 + index), requestId: uuid(30 + index),
  }]));
  return { runMarker: RUN_MARKER, sessions: { ...sessions, ...overrides } };
}

function input(overrides: Record<string, any> = {}) {
  return {
    challengeNonce: NONCE,
    receiptId: uuid(1),
    producer: { path: PRODUCER_PATH, digest: sha("producer-source") },
    harvest: harvest(),
    ...overrides,
  } as any;
}

describe("Kora five-session receipt builder", () => {
  it("emits the exact marker, producer claim and role-ordered sessions the runner greps for", () => {
    const receipt = buildKoraFiveSessionReceipt(input());
    expect(receipt.marker).toBe(KORA_RECEIPT_MARKER);
    expect(KORA_RECEIPT_MARKER).toBe("RUN_FIVE_REQUEST_BOUND_SESSIONS");
    expect(receipt.receiptId).toBe(uuid(1));
    expect(receipt.producer).toEqual({
      path: PRODUCER_PATH, digest: sha("producer-source"), challengeNonce: NONCE, repoOwned: true,
    });
    expect(receipt.sessions.map((session) => session.role)).toEqual(CYCLE7_ROLES);
    expect(receipt.sessions).toHaveLength(5);
  });

  it("maps every AP1 login role onto exactly one Cycle 7 role without inventing identifiers", () => {
    expect(AP1_SESSION_BINDINGS.map((binding) => binding.ap1Role)).toEqual(AP1_ROLES);
    expect(AP1_SESSION_BINDINGS.map((binding) => binding.role)).toEqual(CYCLE7_ROLES);
    const receipt = buildKoraFiveSessionReceipt(input());
    for (const binding of AP1_SESSION_BINDINGS) {
      const harvested = harvest().sessions[binding.ap1Role as keyof ReturnType<typeof harvest>["sessions"]] as any;
      const emitted = receipt.sessions.find((session) => session.role === binding.role)!;
      expect(emitted).toEqual({ role: binding.role, ...harvested });
    }
  });

  it("refuses a harvest that is missing any of the five authenticated logins", () => {
    const incomplete = harvest();
    delete (incomplete.sessions as any).guest;
    expect(() => buildKoraFiveSessionReceipt(input({ harvest: incomplete })))
      .toThrow("KORA_SESSION_HARVEST_INCOMPLETE");
  });

  it("refuses identifiers that are not RFC-4122 UUIDs accepted by the finalizer", () => {
    for (const field of ["userId", "sessionId", "requestId"]) {
      for (const bad of ["", "not-a-uuid", uuid(11).toUpperCase().replace("-4000-", "-0000-"), `${uuid(11)} `]) {
        expect(() => buildKoraFiveSessionReceipt(input({
          harvest: harvest({ builder: { userId: uuid(13), sessionId: uuid(23), requestId: uuid(33), [field]: bad } }),
        }))).toThrow("KORA_SESSION_IDENTIFIER_INVALID");
      }
    }
  });

  it("refuses reused users, sessions or requests because five bindings must be distinct", () => {
    expect(() => buildKoraFiveSessionReceipt(input({
      harvest: harvest({ guest: { userId: uuid(10), sessionId: uuid(24), requestId: uuid(34) } }),
    }))).toThrow("KORA_SESSION_IDENTIFIER_NOT_DISTINCT");
    expect(() => buildKoraFiveSessionReceipt(input({
      harvest: harvest({ guest: { userId: uuid(14), sessionId: uuid(20), requestId: uuid(34) } }),
    }))).toThrow("KORA_SESSION_IDENTIFIER_NOT_DISTINCT");
    expect(() => buildKoraFiveSessionReceipt(input({
      harvest: harvest({ guest: { userId: uuid(14), sessionId: uuid(24), requestId: uuid(30) } }),
    }))).toThrow("KORA_SESSION_IDENTIFIER_NOT_DISTINCT");
  });

  it("refuses to certify a run whose AP1 success marker is absent or admits production mutation", () => {
    for (const marker of ["", "AP1_NEXT_BUILD_FAILED", "AP1_SUPPORTED_SLICE_E2E_OK users=5 production_changed=true"]) {
      expect(() => buildKoraFiveSessionReceipt(input({ harvest: { ...harvest(), runMarker: marker } })))
        .toThrow("KORA_RUN_NOT_VERIFIED");
    }
  });

  it("refuses a producer identity outside the repository executors directory", () => {
    for (const path of ["", "/absolute/kora-producer.zsh", "tests/pilot-evidence/run-m2-pilot-evidence.zsh",
      "tests/pilot-evidence/executors/../../../escape.zsh"]) {
      expect(() => buildKoraFiveSessionReceipt(input({ producer: { path, digest: sha("producer-source") } })))
        .toThrow("KORA_PRODUCER_IDENTITY_INVALID");
    }
    expect(() => buildKoraFiveSessionReceipt(input({ producer: { path: PRODUCER_PATH, digest: "deadbeef" } })))
      .toThrow("KORA_PRODUCER_IDENTITY_INVALID");
  });

  it("refuses a challenge nonce the finalizer would later reject", () => {
    for (const nonce of ["", "challenge-7f0d9c", "cycle7-challenge-", "cycle7-challenge-7f0d/../9c"]) {
      expect(() => buildKoraFiveSessionReceipt(input({ challengeNonce: nonce }))).toThrow("KORA_CHALLENGE_NONCE_INVALID");
    }
  });

  it("refuses a receipt id the runner jq gate would reject", () => {
    for (const id of ["", uuid(1).replace("-4000-", "-9000-"), "99000000-0000-4000-c000-000000000001"]) {
      expect(() => buildKoraFiveSessionReceipt(input({ receiptId: id }))).toThrow("KORA_RECEIPT_ID_INVALID");
    }
  });

  it("carries no emails, tokens, cookie jars or workstation paths out of the harvest", () => {
    const leaky = harvest();
    (leaky.sessions as any).owner = {
      ...(leaky.sessions as any).owner,
      email: "owner@example.invalid",
      tokenHash: "pkce_1234567890",
      cookieJar: "/Users/designer/evidence/owner.cookies",
    };
    const receipt = buildKoraFiveSessionReceipt(input({ harvest: leaky }));
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain("owner@example.invalid");
    expect(serialized).not.toContain("pkce_1234567890");
    expect(serialized).not.toContain("/Users/");
    expect(Object.keys(receipt.sessions[0]!)).toEqual(["role", "userId", "sessionId", "requestId"]);
    expect(Object.keys(receipt).sort()).toEqual(["marker", "producer", "receiptId", "sessions"]);
  });

  it("rejects harvested values that would smuggle private data into the receipt", () => {
    expect(() => buildKoraFiveSessionReceipt(input({
      harvest: { ...harvest(), runMarker: `${RUN_MARKER} bearer sbp_token_abcdef` },
    }))).toThrow("KORA_RUN_NOT_VERIFIED");
  });

  it("writes the receipt read-protected and never overwrites an existing one", () => {
    const dir = outputDir();
    const path = join(dir, "KORA_RECEIPT.json");
    const receipt = buildKoraFiveSessionReceipt(input());
    writeKoraFiveSessionReceipt(receipt, path);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(receipt);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() => writeKoraFiveSessionReceipt(receipt, path)).toThrow();
  });

  it("produces a receipt the real finalizer accepts as the protected five-session proof", () => {
    const dir = outputDir();
    // pending-external-system.zsh is already allowlisted, so the downstream binding
    // checks exercise a real allowlist entry instead of a hand-written stand-in.
    const producerPath = "tests/pilot-evidence/executors/pending-external-system.zsh";
    const producerDigest = sha(readFileSync(producerPath));
    const koraReceiptPath = join(dir, "KORA_RECEIPT.json");
    const koraReceipt = buildKoraFiveSessionReceipt(input({ producer: { path: producerPath, digest: producerDigest } }));
    writeKoraFiveSessionReceipt(koraReceipt, koraReceiptPath);
    const koraReceiptDigest = sha(readFileSync(koraReceiptPath));

    const executorPath = "tests/pilot-evidence/run-m2-pilot-evidence.zsh";
    const executorDigest = sha(readFileSync(executorPath));
    const verificationReceiptId = uuid(41);
    const manifestDigest = sha("external-manifest");
    const pendingPath = join(dir, "PENDING.json");
    const pending = prepareM2PilotEvidence({
      outputPath: pendingPath, challengeNonce: NONCE, manifestDigest,
      executor: { path: executorPath, digest: executorDigest, verificationReceiptId },
      koraReceipt: koraReceipt as unknown as Record<string, unknown>,
      koraReceiptPath, koraReceiptDigest, koraProducerPath: producerPath, koraProducerDigest: producerDigest,
    });

    const scope = { organizationId: uuid(2), projectId: uuid(3), packageId: uuid(4) };
    const operations = ["publish_m2_layout_version", "submit_m2_client_review", "review_m2_client_submission",
      "append_m2_approved_commit_revision", "publish_m2_m3_handoff"];
    const submissionId = uuid(80); const approvedCommitId = uuid(82);
    finalizeM2PilotEvidence({
      status: "MANIFEST_VALIDATED_PENDING_RUN", challengeNonce: NONCE, manifestDigest, scope,
      executor: { path: executorPath, digest: executorDigest, repoOwned: true, verificationReceiptId },
      sessions: koraReceipt.sessions,
      commands: operations.map((operation, index) => ({
        operation, commandId: uuid(50 + index), requestId: uuid(60 + index), auditEventId: uuid(70 + index),
        actorUserId: koraReceipt.sessions[0]!.userId, actorSessionId: koraReceipt.sessions[0]!.sessionId, ...scope,
        previousStateRevision: 100 + index, resultingStateRevision: 101 + index,
        resultDigest: sha(`result-${index}`), replayDigest: sha(`result-${index}`), replayEqual: true,
      })),
      lineage: { submissionId, submissionRevisionId: uuid(84), reviewId: uuid(81), reviewRevisionId: uuid(85),
        approvedCommitId, approvedCommitRevisionId: uuid(86), clientSubmissionId: submissionId,
        clientReviewRevisionId: uuid(85), handoffId: uuid(83), handoffRevisionId: uuid(87),
        handoffApprovedCommitId: approvedCommitId, handoffApprovedCommitRevisionId: uuid(86) },
      proofs: Object.fromEntries(["audit", "authenticatedRead", "privacy", "tenancy", "replay"].map((name, index) => [name,
        { queryReceiptId: uuid(90 + index), auditReceiptId: uuid(100 + index), digest: sha(`proof-${index}`) }])),
      runFiveSessions: koraReceipt,
      pendingBinding: (pending as any).pendingBinding,
    }, { outputDir: dir, pending, pendingPath, koraReceiptPath, label: "External real package" });

    expect(existsSync(join(dir, "PASS.json"))).toBe(true);
    const pass = JSON.parse(readFileSync(join(dir, "PASS.json"), "utf8"));
    expect(pass.verdict).toBe("EXTERNAL_REAL_PACKAGE_PASS");
    expect(pass.koraRun).toEqual({ receiptId: koraReceipt.receiptId, digest: koraReceiptDigest });
  });
});

describe("Kora five-session producer executable", () => {
  const shell = () => readFileSync(PRODUCER_PATH, "utf8");

  it("is a repository-owned executor that runs the real AP1 five-session flow", () => {
    expect(existsSync(PRODUCER_PATH)).toBe(true);
    expect(statSync(PRODUCER_PATH).mode & 0o111).not.toBe(0);
    expect(shell()).toContain("tests/ap1/e2e/run-five-sessions.zsh");
  });

  it("orders the flow as run -> harvest -> build receipt, never receipt before run", () => {
    const source = shell();
    const run = source.indexOf("tests/ap1/e2e/run-five-sessions.zsh");
    const harvestStep = source.indexOf("harvest_file");
    const build = source.indexOf("kora-five-session-receipt-cli.ts");
    expect(run).toBeGreaterThan(-1);
    expect(harvestStep).toBeGreaterThan(run);
    expect(build).toBeGreaterThan(harvestStep);
  });

  it("takes session identifiers from the live run instead of generating them", () => {
    const source = shell();
    expect(source).toContain("auth.sessions");
    expect(source).toContain("/api/projectceo/portfolio");
    expect(source).toMatch(/\.requestId/);
    expect(source).not.toMatch(/uuidgen[^)]*(user|session|request)_id/i);
  });

  it("restores the cleanup that AP1_KEEP_EVIDENCE suppresses so no session file survives", () => {
    const source = shell();
    expect(source).toContain("AP1_KEEP_EVIDENCE=1");
    expect(source).toContain("AP1_KEEP_EVIDENCE_ACTIVE");
    for (const handle of ["next_pid", "runtime", "projectceo-ap1-sessions.json", "projectceo-ap1-next.log"]) {
      expect(source).toContain(handle);
    }
  });

  it("refuses to run when the receipt path already exists and cleans up on failure", () => {
    const source = shell();
    expect(source).toContain("set -euo pipefail");
    expect(source).toContain("KORA_PRODUCER_RECEIPT_PATH_EXISTS");
    expect(source).toMatch(/trap cleanup EXIT/);
  });

  it("is not allowlisted until an independent reviewer adds it", () => {
    const allowlist = JSON.parse(readFileSync("tests/pilot-evidence/executors/allowlist.json", "utf8"));
    expect(allowlist.executors.some((entry: any) => entry.path === PRODUCER_PATH)).toBe(false);
  });
});

describe("Cycle 7 shell teardown", () => {
  const shells = [
    "tests/pilot-evidence/run-m2-pilot-evidence.zsh",
    "tests/pilot-evidence/executors/kora-five-session-producer.zsh",
  ];

  it("never captures an exit code in zsh's read-only `status` parameter", () => {
    // `local status=$?` aborts the trap handler on its first line, so a failing
    // run would keep the artefacts the cleanup is supposed to destroy.
    for (const shell of shells) {
      expect(readFileSync(shell, "utf8")).not.toMatch(/\blocal\s+status=/);
    }
  });

  it("keeps every allowlisted digest equal to the file on disk", () => {
    const allowlist = JSON.parse(readFileSync("tests/pilot-evidence/executors/allowlist.json", "utf8"));
    for (const entry of allowlist.executors as { path: string; digest: string }[]) {
      expect(sha(readFileSync(entry.path)), entry.path).toBe(entry.digest);
    }
  });

  const zshAvailable = spawnSync("zsh", ["--version"], { encoding: "utf8" }).status === 0;
  it.skipIf(!zshAvailable)("runs the runner's cleanup instead of aborting it on a not_supplied exit", () => {
    const env = { ...process.env };
    delete env.ARCHIDOM_EXTERNAL_PILOT_MANIFEST;
    const run = spawnSync("zsh", ["tests/pilot-evidence/run-m2-pilot-evidence.zsh"], { encoding: "utf8", env });
    expect(run.status).toBe(66);
    expect(run.stderr).toContain('"status":"not_supplied"');
    expect(run.stderr).not.toContain("read-only variable");
  });
});
