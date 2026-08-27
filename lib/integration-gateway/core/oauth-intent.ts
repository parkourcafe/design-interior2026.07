import { createHash, randomBytes } from "node:crypto";

export interface OAuthIntentState {
  readonly rawState: string;
  readonly stateDigestHex: string;
}

export interface PkceChallenge {
  readonly verifier: string;
  readonly challenge: string;
  readonly method: "S256";
}

export function createOAuthIntentState(): OAuthIntentState {
  const rawState = randomBytes(32).toString("base64url");
  return {
    rawState,
    stateDigestHex: sha256Hex(rawState),
  };
}

export function createPkceChallenge(): PkceChallenge {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier, "utf8").digest("base64url"),
    method: "S256",
  };
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function redirectUriHashHex(redirectUri: URL): string {
  return sha256Hex(redirectUri.toString());
}
