import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extractCookieTokens } from "../../pilot-evidence/cookie-session";

async function main() {
  const [apiUrl, anonKey, jarPath, projectId, packageId, decisionNodeId, checksumHex] = process.argv.slice(2);
  if (!apiUrl || !anonKey || !jarPath || !projectId || !packageId || !decisionNodeId || !/^[0-9a-f]{64}$/i.test(checksumHex ?? "")) {
    throw new Error("AP1_IMPACT_DEPENDENCY_ARGS_REQUIRED");
  }
  const sourceChecksum = String(checksumHex);
  const tokens = extractCookieTokens(readFileSync(jarPath, "utf8"));
  const scopeResponse = await fetch(`${apiUrl}/rest/v1/rpc/list_projects`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${tokens.accessToken}`, "Content-Profile": "projectceo_api", "Accept-Profile": "projectceo_api", "Content-Type": "application/json" },
    body: "{}",
  });
  const scopeBody = await scopeResponse.json() as { readonly data?: readonly { readonly projectId?: string; readonly stateRevision?: number }[] };
  const stateRevision = scopeBody.data?.find((item) => item.projectId === projectId)?.stateRevision;
  if (!scopeResponse.ok || !Number.isSafeInteger(stateRevision) || stateRevision === undefined) {
    throw new Error("AP1_IMPACT_DEPENDENCY_SCOPE_MISSING");
  }
  const relationPayload = { schemaVersion: "project-ceo/photo-impact-link/0.1", photoChecksum: sourceChecksum, dependsOn: decisionNodeId };
  const relationChecksum = createHash("sha256").update(JSON.stringify(relationPayload)).digest("hex");
  const sourceId = `source-photo-impact-${relationChecksum.slice(0, 24)}`;
  const revisionId = "revision-kora-photo-impact-r1";
  const nodeId = `node-${sourceId}`;
  const payload = { ...relationPayload, sourceId };
  const response = await fetch(`${apiUrl}/rest/v1/rpc/ingest_source_graph`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${tokens.accessToken}`, "Content-Profile": "projectceo_api", "Accept-Profile": "projectceo_api", "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      source: {
        sourceId, sourceRevisionId: revisionId, kind: "plain_text", checksumHex: relationChecksum, packageId,
        metadata: { originalFilename: "kora-photo-impact-link.json", mediaType: "application/json", sizeBytes: Buffer.byteLength(JSON.stringify(payload)), extension: "json", sourceRole: "reference", declaredRevision: null, documentStatus: "current" },
      },
      fragments: [],
      nodes: [{ nodeId, kind: "source", stableKey: `source:${sourceId}`, currentRevisionId: revisionId }],
      revisions: [{ revisionId, nodeId, revisionNo: 1, title: "Kora photo impact dependency", payload, origin: "import", claimStatus: "extracted", unknownReason: null, replacesRevisionId: null, contentDigestHex: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }],
      evidence_links: [],
      edges: [{ edgeId: "kora-photo-impact-dependency-edge", fromNodeId: nodeId, toNodeId: decisionNodeId, relation: "depends_on" }],
      expected_state_revision: stateRevision,
      idempotency_key: "ap1:kora:ingest-photo-impact-dependency",
    }),
  });
  const body = await response.json() as { readonly result?: { readonly ingestionId?: string }; readonly error?: { readonly code?: unknown } };
  const errorCode = typeof body.error?.code === "string" ? body.error.code : "unknown";
  if (!response.ok || typeof body.result?.ingestionId !== "string") throw new Error(`AP1_IMPACT_DEPENDENCY_INGEST_FAILED_${response.status}_${errorCode}`);
  process.stdout.write(`${body.result.ingestionId}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message.replace(/\s+/g, "_") : "AP1_IMPACT_DEPENDENCY_FAILED"}\n`);
  process.exitCode = 1;
});
