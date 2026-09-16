import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { extractCookieTokens } from "../../pilot-evidence/cookie-session";

const [apiUrl, anonKey, jarPath, projectId, packageId, versionId, stateRevision] = process.argv.slice(2);
if (!apiUrl || !anonKey || !jarPath || !projectId || !packageId || !versionId || !stateRevision) {
  throw new Error("AP1_GUEST_GRANT_ARGS_REQUIRED");
}
const tokens = extractCookieTokens(readFileSync(jarPath, "utf8"));
const raw = randomBytes(32);
const token = raw.toString("base64url");
const tokenDigest = `\\x${createHash("sha256").update(raw).digest("hex")}`;
const response = await fetch(`${apiUrl}/rest/v1/rpc/create_guest_access_grant`, {
  method: "POST",
  headers: {
    apikey: anonKey,
    Authorization: `Bearer ${tokens.accessToken}`,
    "Content-Profile": "projectceo_api",
    "Accept-Profile": "projectceo_api",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    project_id: projectId, package_id: packageId, version_id: versionId,
    allow_acknowledgement: false,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    token_digest: tokenDigest,
    expected_state_revision: Number(stateRevision),
    idempotency_key: "ap1:kora:create-final-release-guest",
  }),
});
const body = await response.json() as { readonly result?: unknown };
if (!response.ok || !body.result) throw new Error("AP1_GUEST_GRANT_RPC_FAILED");
process.stdout.write(`${token}\n`);
