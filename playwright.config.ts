import { defineConfig, devices, type ReporterDescription } from "@playwright/test";

// AP5 — browser matrix поверх НАСТОЯЩЕГО стека: Auth, PostgREST, RLS.
// Санитизированный харнесс /projectceo-qa/[role] к этому конфигу отношения не
// имеет и его не заменяет (AP1_RUNBOOK §5).
const baseURL = process.env.AP5_APP_URL ?? "http://127.0.0.1:3100";
const reporters: ReporterDescription[] = process.env.CI
  ? [["github"], ["html", { outputFolder: "playwright-report", open: "never" }], ["list"]]
  : [["list"]];
if (process.env.PLAYWRIGHT_JSON_OUTPUT_FILE) {
  reporters.push(["json", { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE }]);
}

export default defineConfig({
  testDir: "./tests/ap5",
  globalSetup: "./tests/ap5/global-setup.ts",
  // Цепочка Kora строго последовательная: шаг N опирается на состояние,
  // которое создал шаг N-1, и на state_revision проекта. Параллелизм здесь
  // ломает оптимистическую блокировку, а не находит гонки.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // Ретраев нет намеренно: AP5 — гейт доказательства, а не проверка стабильности
  // вёрстки. Зелёный со второй попытки здесь ничего не доказывает.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: reporters,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // Все мутации ProjectCEO проверяют same-origin (delivery/projectceo/csrf.ts),
    // поэтому запросы из теста должны выглядеть как запросы страницы.
    extraHTTPHeaders: { Origin: baseURL },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
