import { readFileSync } from "node:fs";

const status = JSON.parse(readFileSync(0, "utf8"));
const apiUrl = status.API_URL ?? status.api?.url;
const anonKey = status.ANON_KEY ?? status.api?.anon_key;

if (!apiUrl || !anonKey) {
  throw new Error("AP1_STATUS_MISSING_API_URL_OR_ANON_KEY");
}

const allowedSchemas = [
  "public",
  "projectceo_api",
  "projectceo_read_api",
  "projectceo_product_api",
  "projectceo_m4_api",
];
const privateSchemas = [
  "project_intelligence",
  "project_intelligence_api",
  "projectceo_foundation",
  "projectceo_product",
  "projectceo_m4",
];

async function requestSchema(schema) {
  return fetch(`${apiUrl}/rest/v1/`, {
    headers: {
      apikey: anonKey,
      "Accept-Profile": schema,
    },
  });
}

for (const schema of allowedSchemas) {
  const response = await requestSchema(schema);
  if (!response.ok) {
    throw new Error(`AP1_ALLOWED_SCHEMA_FAILED schema=${schema} status=${response.status}`);
  }
}

for (const schema of privateSchemas) {
  const response = await requestSchema(schema);
  if (response.status !== 406) {
    throw new Error(`AP1_PRIVATE_SCHEMA_EXPOSED schema=${schema} status=${response.status}`);
  }
}

const healthHeaders = { apikey: anonKey };
const authHealth = await fetch(`${apiUrl}/auth/v1/health`, {
  headers: healthHeaders,
});
if (!authHealth.ok) {
  throw new Error(`AP1_AUTH_HEALTH_FAILED status=${authHealth.status}`);
}

const storageHealth = await fetch(`${apiUrl}/storage/v1/status`, {
  headers: healthHeaders,
});
if (!storageHealth.ok) {
  throw new Error(`AP1_STORAGE_HEALTH_FAILED status=${storageHealth.status}`);
}

console.log(
  `AP1_RUNTIME_OK api=${new URL(apiUrl).origin} allowed_schemas=${allowedSchemas.length} private_schemas_blocked=${privateSchemas.length} auth=true storage=true`,
);
