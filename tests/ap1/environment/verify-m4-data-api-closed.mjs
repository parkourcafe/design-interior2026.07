/**
 * Прямой обход приложения через Data API для модуля 4 — буквально, а не
 * моделью.
 *
 * Тот же приём, что и у `verify-m3-data-api-closed.mjs`, и по той же причине:
 * DB4 проверяет роль из-под `SET ROLE authenticated`, а пользователь ходит
 * иначе — реальный access token, реальный PostgREST, реальный HTTP. Между
 * моделью и путём помещается ровно то, что уже подводило.
 *
 * Здесь этот скрипт нужен ещё и потому, что первая попытка закрыть границу
 * модуля 4 (`20260810070000`) её не закрыла: она отзывала права по схеме
 * `projectceo_m4_api` и не видела четыре командные RPC модуля, живущие в
 * продуктовой схеме. Выдача и подтверждение получения оставались доступны
 * аутентифицированной сессии при выключенном модуле. Проверка ниже падает,
 * если такое повторится.
 *
 * Что делает скрипт:
 *   1. входит настоящим пользователем (Auth REST) и получает access token;
 *   2. КОНТРОЛЬ: тем же токеном зовёт разрешённую RPC и требует успеха — без
 *      этого сломанный пароль давал бы «всё закрыто» на пустом месте;
 *   3. зовёт командные RPC обоих инкрементов модуля 4 и требует отказа.
 *
 * Запускается ДО включения второй границы (`enable-m4-increment-1.sql`) — иначе
 * мерил бы уже открытую базу.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const domain = process.env.AP1_EMAIL_DOMAIN ?? "remhaos.test";
const password = process.env.AP1_TEST_PASSWORD;

if (!url || !anonKey || !password) {
  throw new Error("AP1_M4_DATA_API_ENV_MISSING");
}

const email = `owner@ap1.${domain}`;
const probeProject = "00000000-0000-4000-8000-000000000000";
const probeHash = `sha256:${"0".repeat(64)}`;

async function accessToken() {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(`AP1_M4_DATA_API_SIGN_IN_FAILED:${response.status}`);
  }
  const body = await response.json();
  if (!body.access_token) throw new Error("AP1_M4_DATA_API_NO_ACCESS_TOKEN");
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
    `AP1_M4_DATA_API_CONTROL_FAILED:${control.status}:${await control.text()}`,
  );
}

// 3. Обе половины модуля закрыты. Аргументы намеренно негодные: отказ обязан
// прийти по правам, до тела функции. 404 — PostgREST не показывает роли
// функцию, на которую у неё нет прав; 401/403 — отказ явный. 400 недопустим
// так же, как успех: он означал бы, что вызов дошёл до валидации аргументов.
const denied = [
  // Инкремент 1 — открыт A6, но закрыт по умолчанию до явного включения среды.
  ["projectceo_product_api", "distribute_release_request_bound", {
    project_id: probeProject,
    artifact_id: "probe",
    recipient_user_id: probeProject,
    expected_state_revision: 1,
    idempotency_key: "probe",
  }],
  ["projectceo_product_api", "distribute_release", {
    project_id: probeProject,
    artifact_id: "probe",
    recipient_user_id: probeProject,
    expected_state_revision: 1,
    idempotency_key: "probe",
  }],
  ["projectceo_product_api", "acknowledge_release_request_bound", {
    project_id: probeProject,
    distribution_id: probeProject,
    expected_semantic_hash: probeHash,
    expected_state_revision: 1,
    idempotency_key: "probe",
  }],
  ["projectceo_product_api", "acknowledge_release", {
    project_id: probeProject,
    distribution_id: probeProject,
    expected_semantic_hash: probeHash,
    expected_state_revision: 1,
    idempotency_key: "probe",
  }],
  ["projectceo_m4_api", "submit_change_request", {
    project_id: probeProject,
    package_id: probeProject,
    from_baseline_id: "probe",
    proposed_baseline_id: "probe",
    from_production_package_version_id: "probe",
    reason: "probe",
    delta_cost_rub: 0,
    delta_days: 0,
    expected_state_revision: 1,
    idempotency_key: "probe",
  }],
  // Инкремент 2 — не открыт ничем и не открывается ни одной средой.
  ["projectceo_m4_api", "review_change_impact", {
    project_id: probeProject,
    impact_run_id: probeProject,
    impact_id: "probe",
    disposition: "resolved",
    reason: "probe",
    expected_state_revision: 1,
    idempotency_key: "probe",
  }],
  ["projectceo_m4_api", "accept_milestone", {
    project_id: probeProject,
    milestone_id: probeProject,
    expected_state_revision: 1,
    idempotency_key: "probe",
  }],
  ["projectceo_m4_api", "build_construction_handover", {
    project_id: probeProject,
    package_id: probeProject,
    handover_id: "probe",
    expected_state_revision: 1,
    idempotency_key: "probe",
  }],
];

for (const [schema, name, payload] of denied) {
  const response = await rpc(token, schema, name, payload);
  if (![401, 403, 404].includes(response.status)) {
    throw new Error(
      `AP1_M4_DATA_API_EXECUTION_REACHABLE:${schema}.${name}:${response.status}:${await response.text()}`,
    );
  }
}

process.stdout.write("AP1_M4_DATA_API_CLOSED_OK\n");
