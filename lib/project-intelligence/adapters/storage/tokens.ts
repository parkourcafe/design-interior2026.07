import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type { PostgresBytea } from "../postgres";

const MINIMUM_SECRET_BYTES = 32;

function assertSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < MINIMUM_SECRET_BYTES) {
    throw new Error("PROJECTCEO token secret must contain at least 32 bytes");
  }
}

function toPostgresBytea(bytes: Uint8Array): PostgresBytea {
  return `\\x${Buffer.from(bytes).toString("hex")}` as PostgresBytea;
}

/**
 * Deterministic per idempotency key, so a response-loss retry returns the same
 * one-time token without persisting plaintext. Security comes from the server-only
 * 256-bit secret; the database receives only SHA-256(raw token bytes).
 */
export function deriveOpaqueToken(input: {
  readonly secret: string;
  readonly namespace: "invitation" | "guest";
  readonly scope: string;
  readonly idempotencyKey: string;
}): { readonly rawToken: string; readonly tokenDigest: PostgresBytea } {
  assertSecret(input.secret);
  const tokenBytes = createHmac("sha256", input.secret)
    .update(
      `project-ceo/${input.namespace}/0.1\0${input.scope}\0${input.idempotencyKey}`,
      "utf8",
    )
    .digest();
  const rawToken = tokenBytes.toString("base64url");
  return {
    rawToken,
    tokenDigest: toPostgresBytea(createHash("sha256").update(tokenBytes).digest()),
  };
}

export function digestOpaqueToken(rawToken: string): PostgresBytea {
  let tokenBytes: Buffer;
  try {
    tokenBytes = Buffer.from(rawToken, "base64url");
  } catch {
    throw new Error("Invalid opaque token encoding");
  }
  if (tokenBytes.byteLength !== 32) {
    throw new Error("Invalid opaque token length");
  }
  return toPostgresBytea(createHash("sha256").update(tokenBytes).digest());
}

export function opaqueTokensEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "base64url");
  const rightBytes = Buffer.from(right, "base64url");
  return (
    leftBytes.byteLength === 32 &&
    rightBytes.byteLength === 32 &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
