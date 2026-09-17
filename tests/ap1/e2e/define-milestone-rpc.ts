import { readFileSync } from "node:fs";
import { extractCookieTokens } from "../../pilot-evidence/cookie-session";

async function main() {
const [apiUrl, anonKey, jarPath, projectId, packageId, versionId, areaNodeId] = process.argv.slice(2);
if (!apiUrl || !anonKey || !jarPath || !projectId || !packageId || !versionId || !areaNodeId) throw new Error("AP1_MILESTONE_ARGS_REQUIRED");
const tokens = extractCookieTokens(readFileSync(jarPath, "utf8"));
const stateResponse = await fetch(`${apiUrl}/rest/v1/rpc/list_projects`, {
  method: "POST",
  headers: { apikey: anonKey, Authorization: `Bearer ${tokens.accessToken}`, "Content-Profile": "projectceo_api", "Accept-Profile": "projectceo_api", "Content-Type": "application/json" },
  body: "{}",
});
const stateBody = await stateResponse.json() as { readonly data?: readonly { readonly projectId?: string; readonly stateRevision?: number }[] };
const stateRevision = stateBody.data?.find((project) => project.projectId === projectId)?.stateRevision;
if (!stateResponse.ok || !Number.isSafeInteger(stateRevision) || stateRevision === undefined) throw new Error("AP1_MILESTONE_SCOPE_STATE_MISSING");
const response = await fetch(`${apiUrl}/rest/v1/rpc/define_milestone`, {
  method: "POST",
  headers: {
    apikey: anonKey,
    Authorization: `Bearer ${tokens.accessToken}`,
    "Content-Profile": "projectceo_m4_api",
    "Accept-Profile": "projectceo_m4_api",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    project_id: projectId, package_id: packageId, production_package_version_id: versionId,
    title: "Архитектурный выпуск — проверка по фото", area_node_ids: [areaNodeId],
    expected_state_revision: stateRevision, idempotency_key: "ap1:define-live-architecture-milestone",
  }),
});
const body = await response.json() as { readonly result?: { readonly id?: unknown }; readonly error?: { readonly code?: unknown } };
const errorCode = typeof body.error?.code === "string" ? body.error.code : "unknown";
if (!response.ok || typeof body.result?.id !== "string") throw new Error(`AP1_MILESTONE_RPC_FAILED_${response.status}_${errorCode}`);
process.stdout.write(`${body.result.id}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message.replace(/\s+/g, "_") : "AP1_MILESTONE_RPC_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
