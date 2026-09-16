import { readFileSync } from "node:fs";
import { extractCookieTokens } from "../../pilot-evidence/cookie-session";

const [apiUrl, anonKey, jarPath, projectId, packageId, versionId, areaNodeId, stateRevision] = process.argv.slice(2);
if (!apiUrl || !anonKey || !jarPath || !projectId || !packageId || !versionId || !areaNodeId || !stateRevision) throw new Error("AP1_MILESTONE_ARGS_REQUIRED");
const tokens = extractCookieTokens(readFileSync(jarPath, "utf8"));
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
    expected_state_revision: Number(stateRevision), idempotency_key: "ap1:define-live-architecture-milestone",
  }),
});
const body = await response.json() as { readonly result?: { readonly id?: unknown }; readonly error?: unknown };
if (!response.ok || typeof body.result?.id !== "string") throw new Error("AP1_MILESTONE_RPC_FAILED");
process.stdout.write(`${body.result.id}\n`);
