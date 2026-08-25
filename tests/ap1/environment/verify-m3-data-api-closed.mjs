/**
 * Прямой обход приложения через Data API — буквально, а не моделью.
 *
 * Почему DB4 недостаточно. Там проверка идёт из-под `SET ROLE authenticated`
 * внутри psql: это модель роли, но не путь пользователя. Настоящий обход
 * выглядит иначе — реальный access token, реальный PostgREST, реальный HTTP.
 * Между моделью и путём помещается ровно то, что уже подводило: экспозиция
 * схемы, разрешение имени функции, права роли `anon` против `authenticated`.
 * Условие владельца от 11.08 требует именно буквальной проверки.
 *
 * Что делает скрипт:
 *   1. входит настоящим пользователем (Auth REST) и получает access token
 *      с ролью `authenticated`;
 *   2. КОНТРОЛЬ: тем же токеном зовёт разрешённую RPC и требует успеха. Без
 *      этого шага сломанный пароль давал бы «всё закрыто» на пустом месте, и
 *      тест проходил бы, ничего не проверив;
 *   3. зовёт три публикующие RPC модуля 3 и требует отказа;
 *   4. требует, чтобы приватная `project_intelligence_api` не была отдана
 *      Data API вовсе.
 *
 * Запускается ДО включения второй границы (`enable-m3-publication.sql`) — иначе
 * мерил бы уже открытую базу.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const domain = process.env.AP1_EMAIL_DOMAIN ?? "remhaos.test";
const password = process.env.AP1_TEST_PASSWORD;

if (!url || !anonKey || !password) {
  throw new Error("AP1_M3_DATA_API_ENV_MISSING");
}

const email = `owner@ap1.${domain}`;

async function accessToken() {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(`AP1_M3_DATA_API_SIGN_IN_FAILED:${response.status}`);
  }
  const body = await response.json();
  if (!body.access_token) throw new Error("AP1_M3_DATA_API_NO_ACCESS_TOKEN");
  return body.access_token;
}

async function rpc(token, schema, name, payload) {
  return fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Profile": schema,
      "Accept-Profile": schema,
    },
    body: JSON.stringify(payload),
  });
}

const token = await accessToken();

// 2. Контроль: токен настоящий и рабочий.
const control = await rpc(token, "projectceo_api", "list_projects", {});
if (!control.ok) {
  throw new Error(
    `AP1_M3_DATA_API_CONTROL_FAILED:${control.status}:${await control.text()}`,
  );
}

// 3. Публикация закрыта. Аргументы намеренно негодные: отказ обязан прийти по
// правам, до тела функции. 404 — PostgREST не показывает роли функцию, на
// которую у неё нет прав; 401/403 — отказ явный. Успех недопустим ни в каком
// виде, как и 400: 400 означал бы, что вызов дошёл до валидации аргументов.
const denied = [
  ["projectceo_api", "review_source", {
    project_id: "00000000-0000-4000-8000-000000000000",
    target_revision_id: "probe",
    expected_revision_id: "probe",
    expected_state_revision: 1,
    decision: "confirmed",
    idempotency_key: "probe",
  }],
  ["projectceo_m3_api", "register_documentation_sheet", {
    project_id: "00000000-0000-4000-8000-000000000000",
    package_id: "00000000-0000-4000-8000-000000000000",
    handoff_id: "probe",
    handoff_revision_id: "probe",
    sheet_id: "probe",
    sheet_number: "probe",
    title: "probe",
    revision_id: "probe",
    specification_revision_ids: [],
    reason: "probe",
    expected_state_revision: 1,
    idempotency_key: "probe",
  }],
  ["projectceo_m3_api", "attach_documentation_sheet_specifications", {
    project_id: "00000000-0000-4000-8000-000000000000",
    package_id: "00000000-0000-4000-8000-000000000000",
    sheet_id: "probe",
    revision_id: "probe",
    expected_revision_id: "probe",
    specification_revision_ids: [],
    reason: "probe",
    expected_state_revision: 1,
    idempotency_key: "probe",
  }],
  ["projectceo_api", "publish_version", {
    project_id: "00000000-0000-4000-8000-000000000000",
    expected_latest_version_id: null,
    expected_state_revision: 1,
    label: "probe",
    selected_revisions: [],
    idempotency_key: "probe",
  }],
  ["projectceo_product_api", "publish_project_baseline", {
    project_id: "00000000-0000-4000-8000-000000000000",
    descriptor: {},
    expected_state_revision: 1,
    idempotency_key: "probe",
  }],
  ["projectceo_product_api", "publish_production_package_version", {
    project_id: "00000000-0000-4000-8000-000000000000",
    descriptor: {},
    expected_state_revision: 1,
    idempotency_key: "probe",
  }],
];

for (const [schema, name, payload] of denied) {
  const response = await rpc(token, schema, name, payload);
  if (![401, 403, 404].includes(response.status)) {
    throw new Error(
      `AP1_M3_DATA_API_PUBLICATION_REACHABLE:${schema}.${name}:${response.status}:${await response.text()}`,
    );
  }
}

// 4. Приватная схема не отдана Data API вовсе.
//
// Корневой эндпоинт `/rest/v1/` на новых hosted-проектах отвечает
// 401 `UNAUTHORIZED_INVALID_API_KEY_TYPE` на статические ключи любого типа
// (шлюз закрыл OpenAPI-корень), поэтому при таком отказе схема проверяется
// пробой реальной таблицы: неэкспонированная схема отвечает
// 406 `Invalid schema`, экспонированная отдала бы таблицу (200) или
// её отсутствие (404), но не 406.
let privateSchema = await fetch(`${url}/rest/v1/`, {
  headers: {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    "Accept-Profile": "project_intelligence_api",
  },
});
if (
  privateSchema.status === 401
  && (privateSchema.headers.get("sb-error-code") ?? "") === "UNAUTHORIZED_INVALID_API_KEY_TYPE"
) {
  privateSchema = await fetch(`${url}/rest/v1/events?select=*&limit=0`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Accept-Profile": "project_intelligence_api",
    },
  });
}
if (privateSchema.status !== 406) {
  throw new Error(
    `AP1_M3_PRIVATE_SCHEMA_EXPOSED:${privateSchema.status}`,
  );
}

process.stdout.write("AP1_M3_DATA_API_CLOSED_OK\n");
