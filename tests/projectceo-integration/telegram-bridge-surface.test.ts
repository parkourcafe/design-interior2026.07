import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  isTelegramBridgeEnabled,
  TELEGRAM_BRIDGE_DISABLED_REASON,
} from "../../lib/integration-gateway/telegram/bridge-flag";
import {
  TELEGRAM_BRIDGE_CAPABILITY,
  TELEGRAM_BRIDGE_HUMAN_SIGNATURES,
  TELEGRAM_BRIDGE_PRIVATE_SCHEMA,
  TELEGRAM_BRIDGE_SURFACE,
  TELEGRAM_BRIDGE_SYSTEM_SIGNATURES,
} from "../../lib/integration-gateway/telegram/bridge-surface";

const repoRoot = process.cwd();
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf8");
const squash = (value: string): string => value.replace(/\s+/g, "");

/**
 * Поверхность моста растёт миграциями, и матрица обязана расти вместе с ней.
 * Списки собираются из ВСЕХ операционных миграций сразу: сверка с одной,
 * пока существуют две, — это ровно тот способ, каким guardrail отчитывается об
 * успехе, проверив половину.
 */
const OPERATION_MIGRATIONS = [
  "supabase/migrations/20260811050000_remhaos_channel_bridge_operations.sql",
  "supabase/migrations/20260811060000_remhaos_channel_bridge_inbox.sql",
  // Исправление фундамента (CORRECTIVE GO 11.08.2026): часть системных дверей
  // здесь пересоздана с новой сигнатурой, и грант живёт вместе с ними. Список,
  // не включающий эту миграцию, сверял бы матрицу с уже неверной половиной.
  "supabase/migrations/20260811070000_remhaos_channel_bridge_correction.sql",
] as const;

const DB4_SCENARIOS = [
  "tests/db4/42_telegram_bridge_boundary.sql",
  "tests/db4/43_telegram_inbox_vertical.sql",
  "tests/db4/44_telegram_bridge_correction.sql",
] as const;

const operationSources = OPERATION_MIGRATIONS.map(read);
const operations = operationSources.join("\n");
const foundation = read(
  "supabase/migrations/20260811040000_remhaos_channel_bridge_foundation.sql",
);

/**
 * Куски гранта — по одному на миграцию, чтобы стороны не слипались.
 *
 * Якоря С ДВОЕТОЧИЕМ. Без него `-- Системные двери` совпадает ещё и с
 * заголовком раздела ОПРЕДЕЛЕНИЙ функций, который стоит намного выше грантов:
 * срез начинался оттуда и втягивал в «системную» половину весь человеческий
 * грант. Первая редакция была написана именно так и падала на
 * `create_identity_link_intent` — падала верно.
 */
const HUMAN_ANCHOR = "-- Человеческие двери:";
const SYSTEM_ANCHOR = "-- Системные двери:";

function grantSections(marker: "human" | "system"): string {
  return operationSources
    .map((source) => {
      const from = source.indexOf(marker === "human" ? HUMAN_ANCHOR : SYSTEM_ANCHOR);
      if (from < 0) return "";
      const until = marker === "human"
        ? source.indexOf(SYSTEM_ANCHOR, from)
        : source.indexOf("do $guard$", from);
      return source.slice(from, until < 0 ? source.length : until);
    })
    .join("\n");
}

describe("Telegram bridge flag", () => {
  it("treats an absent variable as closed, and only the literal string as open", () => {
    // Забыть выставить переменную обязано означать «закрыто», а не
    // «неизвестно» — тот же приём, что у флагов модулей 2, 3 и 4.
    expect(isTelegramBridgeEnabled(undefined)).toBe(false);
    expect(isTelegramBridgeEnabled("")).toBe(false);
    for (const near of ["1", "TRUE", "True", "yes", "on", " true"]) {
      expect(isTelegramBridgeEnabled(near), near).toBe(false);
    }
    expect(isTelegramBridgeEnabled("true")).toBe(true);
  });

  it("names the closed state by its real reason", () => {
    // «Нет прав» было бы ложью: дело не в правах, а в выключенном мосте.
    expect(TELEGRAM_BRIDGE_DISABLED_REASON).toBe("bridge_disabled");
  });

  it("keeps the flag out of the browser bundle", () => {
    // Клиентский флаг обходится из консоли. Переменная серверная, и префикса
    // NEXT_PUBLIC_ у неё нет и быть не должно.
    expect(read("lib/integration-gateway/telegram/bridge-flag.ts"))
      .toContain("process.env.REMHAOS_TELEGRAM_BRIDGE_ENABLED");
    expect(read("lib/integration-gateway/telegram/bridge-flag.ts"))
      .not.toContain("NEXT_PUBLIC_");
  });
});

/**
 * Матрица поверхности — источник истины, а не иллюстрация. Уроком служат оба
 * guardrail'а модулей 3 и 4: сплошной revoke по схеме выглядел исчерпывающим и
 * дважды им не был.
 */
describe("Telegram bridge surface matrix", () => {
  it("classifies every door as system or human, and nothing in between", () => {
    expect(TELEGRAM_BRIDGE_SURFACE.length).toBeGreaterThan(0);
    for (const rpc of TELEGRAM_BRIDGE_SURFACE) {
      expect(rpc.signature.startsWith(`${rpc.schema}.${rpc.name}(`), rpc.signature).toBe(true);
      expect(["system", "human"]).toContain(rpc.audience);
      // У системной двери capability нет по определению: её зовёт не человек.
      if (rpc.audience === "system") expect(rpc.capability, rpc.name).toBeNull();
    }
    expect(
      TELEGRAM_BRIDGE_SYSTEM_SIGNATURES.length + TELEGRAM_BRIDGE_HUMAN_SIGNATURES.length,
    ).toBe(TELEGRAM_BRIDGE_SURFACE.length);
  });

  it("matches the migration grant for grant, in both directions", () => {
    const humanGrant = grantSections("human");
    const systemGrant = grantSections("system");

    for (const signature of TELEGRAM_BRIDGE_HUMAN_SIGNATURES) {
      expect(squash(humanGrant), signature).toContain(squash(signature));
      // Человеческая дверь не имеет права оказаться в системном гранте.
      expect(squash(systemGrant), signature).not.toContain(squash(signature));
    }
    for (const signature of TELEGRAM_BRIDGE_SYSTEM_SIGNATURES) {
      expect(squash(systemGrant), signature).toContain(squash(signature));
      expect(squash(humanGrant), signature).not.toContain(squash(signature));
    }
  });

  it("keeps the DB4 scenarios mirroring the system half of the matrix", () => {
    // SQL не импортирует TypeScript, поэтому списка два. Разойдись они —
    // сценарий проверял бы не ту поверхность, которую описывает матрица.
    const scenarios = squash(DB4_SCENARIOS.map(read).join("\n"));
    for (const signature of TELEGRAM_BRIDGE_SYSTEM_SIGNATURES) {
      expect(scenarios, signature).toContain(squash(signature));
    }
  });

  it("keeps every bridge harness wired into the DB4 runner", () => {
    // Апгрейд населённой базы живёт в отдельном скрипте, потому что ему нужен
    // собственный кластер: prelude заводит роли Supabase на весь сервер.
    // Отдельный файл легко забыть позвать — и он молча перестанет что-либо
    // доказывать, оставаясь в репозитории как свидетельство обратного.
    const runner = read("tests/db4/run.zsh");
    expect(runner).toContain("run-telegram-concurrency.zsh");
    expect(runner).toContain("run-telegram-upgrade.zsh");
    expect(runner).toContain("47_telegram_pending_ambiguity.sql");

    // Гонки обязаны доказывать ожидание на НАСТОЯЩЕМ замке, а не одновременный
    // подход к старту: сессия удерживает транзакцию открытой, и пересечение
    // подтверждается строкой `granted = false` в `pg_locks` на том же ключе.
    const races = read("tests/db4/run-telegram-concurrency.zsh");
    expect(races).toContain("pg_locks");
    expect(races).toContain("not granted");
    expect(races).toContain("DB4_TGC_REAL_LOCK_CONTENDED");
    // `sleep` допустим только как шаг опроса внутри ожидания условия — в
    // качестве синхронизации он означал бы «наверное, успели».
    expect(races).not.toMatch(/^\s*sleep\s/m);
    const upgrade = read("tests/db4/run-telegram-upgrade.zsh");
    for (const scenario of [
      "45_telegram_bridge_upgrade_seed.sql",
      "46_telegram_bridge_upgrade_assert.sql",
    ]) {
      expect(upgrade, scenario).toContain(scenario);
    }
    // Порядок — весь смысл прогона: живые строки заводятся ДО корректирующей
    // миграции, иначе он повторял бы основной DB4 и ничего нового не говорил.
    expect(upgrade.indexOf("45_telegram_bridge_upgrade_seed.sql"))
      .toBeLessThan(upgrade.indexOf("46_telegram_bridge_upgrade_assert.sql"));
  });

  it("introduces exactly one capability, and only for the project owner", () => {
    expect(TELEGRAM_BRIDGE_CAPABILITY).toBe("manage_project_integrations");
    // Реестр ролей один. Параллельный список — тот самый способ, каким права
    // расходятся между слоями незаметно, поэтому проверяется сама миграция.
    const registry = foundation.slice(
      foundation.indexOf("create or replace function projectceo_foundation._role_capabilities"),
      foundation.indexOf("alter function projectceo_foundation._role_capabilities"),
    );
    const ownerBlock = registry.slice(
      registry.indexOf("when 'owner_lead'"),
      registry.indexOf("when 'architect'"),
    );
    expect(ownerBlock).toContain(TELEGRAM_BRIDGE_CAPABILITY);
    expect(registry.slice(registry.indexOf("when 'architect'")))
      .not.toContain(TELEGRAM_BRIDGE_CAPABILITY);
  });

  it("never exposes the private schema to the Data API", () => {
    expect(TELEGRAM_BRIDGE_PRIVATE_SCHEMA).toBe("remhaos_channel");
    const config = read("supabase/config.toml");
    const api = config.slice(config.indexOf("schemas = ["), config.indexOf("extra_search_path"));
    expect(api).toContain('"remhaos_channel_api"');
    // Приватная схема отличается от api ровно суффиксом, поэтому проверка
    // точная: строка с закрывающей кавычкой сразу после имени.
    expect(api).not.toContain('"remhaos_channel"');
  });
});

/**
 * Инварианты A7, которые обязаны быть невозможны по построению, а не по
 * договорённости. Каждый из них уже нарушался в других системах именно потому,
 * что держался на договорённости.
 */
describe("Telegram bridge invariants", () => {
  it("keeps telegram identifiers out of the domain modules", () => {
    // A7 §2.1: идентификаторы Telegram живут только в слое моста.
    const domainMigrations = [
      "supabase/migrations/20260717100000_projectceo_product_brain_persistence.sql",
      "supabase/migrations/20260717102000_projectceo_m4_execution_persistence.sql",
    ];
    for (const path of domainMigrations) {
      const source = read(path);
      expect(source, path).not.toMatch(/telegram_chat_id|telegram_user_id/);
    }
  });

  it("gives the bridge no door that creates an official object", () => {
    // Кандидат остаётся кандидатом. Ни одна функция моста не зовёт команду
    // домена — иначе «предложено ≠ утверждено» держалось бы на честном слове.
    for (const forbidden of [
      "projectceo_product_api.",
      "projectceo_m4_api.",
      "projectceo_m3_api.",
      "project_intelligence_api.",
    ]) {
      expect(operations, forbidden).not.toContain(forbidden);
    }
  });

  it("stores only the hash of a one-time token, never the token", () => {
    expect(foundation).toContain("nonce_digest bytea not null");
    expect(foundation).toContain("octet_length(nonce_digest) = 32");
    // TTL закреплён проверкой в схеме, а не намерением приложения.
    expect(squash(foundation)).toContain(squash("expires_at <= created_at + interval '10 minutes'"));
  });

  it("keeps one active binding per project and per chat", () => {
    expect(foundation).toContain("project_channel_bindings_one_active_per_project");
    expect(foundation).toContain("project_channel_bindings_one_active_per_chat");
    // Частичные индексы: отозванные связи остаются для аудита и не мешают
    // подключиться заново.
    expect(squash(foundation)).toContain(squash("where status = 'active'"));
  });

  it("refuses to promise exactly-once delivery", () => {
    // Telegram sendMessage не принимает внешний ключ идемпотентности. Обещать
    // exactly-once значило бы обещать то, чего API не даёт.
    expect(foundation).toContain("at-least-once");
    expect(foundation).toContain("notification_outbox_idempotency_key");
  });
});
