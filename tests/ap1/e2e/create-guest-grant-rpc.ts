import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { extractCookieTokens } from "../../pilot-evidence/cookie-session";
import { resolveGuestGraphVersion } from "../../pilot-evidence/guest-release-binding";

async function main() {
const [apiUrl, anonKey, jarPath, projectId, packageId, versionId] = process.argv.slice(2);
if (!apiUrl || !anonKey || !jarPath || !projectId || !packageId || !versionId) {
  throw new Error("AP1_GUEST_GRANT_ARGS_REQUIRED");
}
const tokens = extractCookieTokens(readFileSync(jarPath, "utf8"));
const endpoint = new URL(apiUrl);
if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(endpoint.hostname)) {
  throw new Error("AP1_GUEST_NON_LOOPBACK_REJECTED");
}
const readResponse = await fetch(`${apiUrl}/rest/v1/rpc/get_project_workspace_read`, {
  method: "POST", redirect: "error",
  headers: {
    apikey: anonKey, Authorization: `Bearer ${tokens.accessToken}`,
    "Content-Profile": "projectceo_read_api", "Accept-Profile": "projectceo_read_api",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ project_id: projectId, package_id: null }),
});
if (!readResponse.ok) throw new Error("AP1_GUEST_RELEASE_READ_FAILED");
const graphVersionId = resolveGuestGraphVersion(await readResponse.json(), packageId, versionId);
const stateResponse = await fetch(`${apiUrl}/rest/v1/rpc/list_projects`, {
  method: "POST", redirect: "error",
  headers: { apikey: anonKey, Authorization: `Bearer ${tokens.accessToken}`, "Content-Profile": "projectceo_api", "Accept-Profile": "projectceo_api", "Content-Type": "application/json" },
  body: "{}",
});
const stateBody = await stateResponse.json() as { readonly data?: readonly { readonly projectId?: string; readonly stateRevision?: number }[] };
const stateRevision = stateBody.data?.find((project) => project.projectId === projectId)?.stateRevision;
if (!stateResponse.ok || !Number.isSafeInteger(stateRevision) || stateRevision === undefined) {
  throw new Error("AP1_GUEST_SCOPE_STATE_MISSING");
}
const raw = randomBytes(32);
const token = raw.toString("base64url");
const tokenDigest = `\\x${createHash("sha256").update(raw).digest("hex")}`;
const response = await fetch(`${apiUrl}/rest/v1/rpc/create_guest_access_grant`, {
  method: "POST", redirect: "error",
  headers: {
    apikey: anonKey,
    Authorization: `Bearer ${tokens.accessToken}`,
    "Content-Profile": "projectceo_api",
    "Accept-Profile": "projectceo_api",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    project_id: projectId, package_id: packageId, version_id: graphVersionId,
    allow_acknowledgement: false,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    token_digest: tokenDigest,
    expected_state_revision: stateRevision,
    idempotency_key: "ap1:kora:create-final-release-guest",
  }),
});
const body = await response.json() as { readonly result?: unknown };
if (!response.ok || !body.result) throw new Error("AP1_GUEST_GRANT_RPC_FAILED");
process.stdout.write(`${JSON.stringify({ token, graphVersionId, productionPackageVersionId: versionId })}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message.replace(/\s+/g, "_") : "AP1_GUEST_GRANT_RPC_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
