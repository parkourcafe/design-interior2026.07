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
  "projectceo_m3_api",
  "projectceo_m4_api",
];
const privateSchemas = [
  "project_intelligence",
  "project_intelligence_api",
  "projectceo_foundation",
  "projectceo_product",
  "projectceo_m3",
  "projectceo_m4",
];

// Проверка схемы. ДВА пути, потому что шлюз Supabase ведёт себя по-разному:
//
//  * Корневой эндпоинт `/rest/v1/` (OpenAPI) отвечает на любую схему через
//    `Accept-Profile` — на локальном стеке и на проектах с включёнными
//    legacy JWT-ключами.
//  * На новых hosted-проектах с ключами нового образца
//    (`sb_publishable_*`) шлюз отвечает на корень
//    401 `UNAUTHORIZED_INVALID_API_KEY_TYPE` — корень для них закрыт,
//    хотя доступ к таблицам работает. Для таких ключей схема проверяется
//    пробой РЕАЛЬНОЙ таблицы: неэкспонированная схема отвечает
//    406 `Invalid schema`, экспонированная — любым другим кодом
//    (200 для public, 404 «таблицы нет» для api-схем без таблиц).
const ROOT_REJECTED_FOR_KEY = "UNAUTHORIZED_INVALID_API_KEY_TYPE";
let useTableProbe = false;

async function requestSchema(schema) {
  if (useTableProbe) {
    return fetch(`${apiUrl}/rest/v1/events?select=*&limit=0`, {
      headers: {
        apikey: anonKey,
        "Accept-Profile": schema,
      },
    });
  }
  return fetch(`${apiUrl}/rest/v1/`, {
    headers: {
      apikey: anonKey,
      "Accept-Profile": schema,
    },
  });
}

{
  const probe = await requestSchema(allowedSchemas[0]);
  if (probe.status === 401) {
    const errorCode = probe.headers.get("sb-error-code") ?? "";
    if (errorCode !== ROOT_REJECTED_FOR_KEY) {
      throw new Error(`AP1_ALLOWED_SCHEMA_FAILED schema=${allowedSchemas[0]} status=401`);
    }
    // Корень закрыт для этого типа ключа — переключаемся на пробу таблицы.
    useTableProbe = true;
  }
}

for (const schema of allowedSchemas) {
  const response = await requestSchema(schema);
  // 406 «Invalid schema» на пробе таблицы = схема не экспонирована. Любой
  // другой ответ (200, 404) = схема доступна через Data API.
  if (response.status === 406) {
    throw new Error(`AP1_ALLOWED_SCHEMA_FAILED schema=${schema} status=${response.status}`);
  }
}

for (const schema of privateSchemas) {
  const response = await requestSchema(schema);
  if (!useTableProbe && response.status !== 406) {
    throw new Error(`AP1_PRIVATE_SCHEMA_EXPOSED schema=${schema} status=${response.status}`);
  }
  if (useTableProbe && response.status === 200) {
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
