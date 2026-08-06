import { writeFileSync } from "node:fs";

// The runner greps this marker out of the protected receipt and the finalizer
// re-reads it from disk, so it is the single spelling both gates agree on.
export const KORA_RECEIPT_MARKER = "RUN_FIVE_REQUEST_BOUND_SESSIONS";

// AP1 logs in under its own role names. Cycle 7 records the package roles. The
// order here is the order the runner's jq equality check expects.
export const AP1_SESSION_BINDINGS = [
  { ap1Role: "owner", role: "owner_lead" },
  { ap1Role: "architect", role: "architect" },
  { ap1Role: "client", role: "client_approver" },
  { ap1Role: "builder", role: "builder" },
  { ap1Role: "guest", role: "guest" },
] as const;

// Version 1-5 and variant 8/9/a/b satisfy the runner's jq gate and the stricter
// finalizer regex at once, so a receipt accepted here is accepted downstream.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const CHALLENGE_NONCE = /^cycle7-challenge-[a-z0-9-]{6,128}$/i;
const EXECUTORS_PREFIX = "tests/pilot-evidence/executors/";
const AP1_SUCCESS_MARKER = "AP1_SUPPORTED_SLICE_E2E_OK";
const AP1_PRODUCTION_UNCHANGED = "production_changed=false";
const PRIVATE_DATA = /sk-[a-z0-9_-]+|sbp_token|refresh_token|\/Users\/|\/Volumes\/|\/mnt\/|\.\.\/|bearer\s+\S+/i;

export interface KoraReceiptSession {
  readonly role: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly requestId: string;
}

export interface KoraFiveSessionReceipt {
  readonly marker: typeof KORA_RECEIPT_MARKER;
  readonly receiptId: string;
  readonly producer: {
    readonly path: string;
    readonly digest: string;
    readonly challengeNonce: string;
    readonly repoOwned: true;
  };
  readonly sessions: readonly KoraReceiptSession[];
}

export interface BuildKoraFiveSessionReceiptInput {
  readonly challengeNonce: string;
  readonly receiptId: string;
  readonly producer: { readonly path: string; readonly digest: string };
  readonly harvest: {
    readonly runMarker: string;
    readonly sessions: Readonly<Record<string, unknown>>;
  };
}

const text = (value: unknown): string => typeof value === "string" ? value : "";
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function assertProducer(producer: { readonly path: string; readonly digest: string }): void {
  const path = text(producer.path);
  if (!path.startsWith(EXECUTORS_PREFIX) || path.split("/").includes("..") || !SHA256.test(text(producer.digest))) {
    throw new Error("KORA_PRODUCER_IDENTITY_INVALID");
  }
}

function assertRun(runMarker: string): void {
  if (!runMarker.includes(AP1_SUCCESS_MARKER) || !runMarker.includes(AP1_PRODUCTION_UNCHANGED)
    || PRIVATE_DATA.test(runMarker)) {
    throw new Error("KORA_RUN_NOT_VERIFIED");
  }
}

function harvestSessions(sessions: Readonly<Record<string, unknown>>): readonly KoraReceiptSession[] {
  const bound = AP1_SESSION_BINDINGS.map((binding) => {
    const harvested = sessions[binding.ap1Role];
    if (harvested === undefined || harvested === null) throw new Error("KORA_SESSION_HARVEST_INCOMPLETE");
    const source = record(harvested);
    // Only these three identifiers leave the harvest. Emails, magic-link token
    // hashes and cookie jar paths stay in the disposable run.
    const session: KoraReceiptSession = {
      role: binding.role,
      userId: text(source.userId),
      sessionId: text(source.sessionId),
      requestId: text(source.requestId),
    };
    if (!UUID.test(session.userId) || !UUID.test(session.sessionId) || !UUID.test(session.requestId)) {
      throw new Error("KORA_SESSION_IDENTIFIER_INVALID");
    }
    return session;
  });
  for (const field of ["userId", "sessionId", "requestId"] as const) {
    if (new Set(bound.map((session) => session[field])).size !== bound.length) {
      throw new Error("KORA_SESSION_IDENTIFIER_NOT_DISTINCT");
    }
  }
  return bound;
}

export function buildKoraFiveSessionReceipt(input: BuildKoraFiveSessionReceiptInput): KoraFiveSessionReceipt {
  const challengeNonce = text(input.challengeNonce);
  if (!CHALLENGE_NONCE.test(challengeNonce)) throw new Error("KORA_CHALLENGE_NONCE_INVALID");
  if (!UUID.test(text(input.receiptId))) throw new Error("KORA_RECEIPT_ID_INVALID");
  assertProducer(input.producer);
  assertRun(text(input.harvest?.runMarker));
  return {
    marker: KORA_RECEIPT_MARKER,
    receiptId: input.receiptId,
    producer: {
      path: input.producer.path,
      digest: input.producer.digest,
      challengeNonce,
      repoOwned: true,
    },
    sessions: harvestSessions(record(input.harvest?.sessions)),
  };
}

export function writeKoraFiveSessionReceipt(receipt: KoraFiveSessionReceipt, path: string): void {
  // "wx" keeps a second run from silently replacing a receipt the runner has
  // already digested, and 0600 keeps the identifiers off a shared workstation.
  writeFileSync(path, JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
}
