import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { consentDocumentSchema, type ConsentPurpose, type ConsentAcceptance } from "./consent-policy";

export interface ConsentRpcClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export class ConsentUnavailable extends Error {
  constructor() { super("consent_unavailable"); }
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function proofCookieName(purpose: ConsentPurpose, token: string): string {
  return `remhaos_consent_${purpose}_${digest(token).slice(0, 20)}`;
}

async function browserProof(purpose: ConsentPurpose, token: string) {
  const store = await cookies();
  const name = proofCookieName(purpose, token);
  const value = store.get(name)?.value;
  return { store, name, value: value && /^[a-f0-9]{64}$/.test(value) ? value : null };
}

export async function readConsentDocument(client: ConsentRpcClient, purpose: ConsentPurpose) {
  const { data, error } = await client.rpc("get_current_consent_document", { p_purpose: purpose });
  if (error) throw new ConsentUnavailable();
  if (data === null) return null;
  const parsed = consentDocumentSchema.safeParse(data);
  if (!parsed.success || parsed.data.purpose !== purpose) throw new ConsentUnavailable();
  return parsed.data;
}

export async function hasBrowserConsent(client: ConsentRpcClient, purpose: ConsentPurpose, token = "") {
  const proof = await browserProof(purpose, token);
  if (!proof.value) return false;
  const { data, error } = await client.rpc("has_browser_consent", {
    p_purpose: purpose, p_token: token, p_browser_hash: digest(proof.value),
  });
  if (error || typeof data !== "boolean") throw new ConsentUnavailable();
  return data;
}

const receiptSchema = z.object({
  receiptId: z.string().uuid(), acceptedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
});

export async function recordBrowserConsent(
  client: ConsentRpcClient, purpose: ConsentPurpose, token: string, input: ConsentAcceptance,
) {
  const proof = await browserProof(purpose, token);
  if (!proof.value) throw new ConsentUnavailable();
  const secret = proof.value;
  const { data, error } = await client.rpc("record_browser_consent", {
    p_purpose: purpose, p_token: token, p_browser_hash: digest(secret),
    p_document_id: input.documentId, p_accepted: input.accepted, p_request_id: input.requestId,
  });
  const parsed = receiptSchema.safeParse(data);
  if (error || !parsed.success) throw new ConsentUnavailable();
  // Session cookie, not a retention promise. The DB enforces the separately
  // approved capability lifetime on every use. Never expose the proof to JS.
  proof.store.set(proof.name, secret, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/",
  });
  return parsed.data;
}

export async function withdrawBrowserConsent(
  client: ConsentRpcClient, purpose: ConsentPurpose, token: string, receiptId: string,
) {
  const proof = await browserProof(purpose, token);
  if (!proof.value) throw new ConsentUnavailable();
  const { error } = await client.rpc("withdraw_browser_consent", {
    p_purpose: purpose, p_token: token, p_browser_hash: digest(proof.value), p_receipt_id: receiptId,
  });
  if (error) throw new ConsentUnavailable();
  // Keep the same proof so a lost withdrawal response can be retried idempotently.
}

export async function readBrowserConsentReceipt(client: ConsentRpcClient, purpose: ConsentPurpose, token = "") {
  const proof = await browserProof(purpose, token);
  if (!proof.value) return null;
  const { data, error } = await client.rpc("get_browser_consent_receipt", {
    p_purpose: purpose, p_token: token, p_browser_hash: digest(proof.value),
  });
  if (error) throw new ConsentUnavailable();
  if (data === null) return null;
  const parsed = receiptSchema.safeParse(data);
  if (!parsed.success) throw new ConsentUnavailable();
  return parsed.data;
}

// Establish browser possession in a separate successful document/status response
// before any receipt INSERT, so lost acceptance responses can safely replay.
export async function ensureBrowserConsentProof(purpose: ConsentPurpose, token = "") {
  const proof = await browserProof(purpose, token);
  if (!proof.value) proof.store.set(proof.name, randomBytes(32).toString("hex"), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/",
  });
}
