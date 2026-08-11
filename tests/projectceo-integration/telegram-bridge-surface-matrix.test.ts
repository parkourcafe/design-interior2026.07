import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PROJECT_INBOX_CANDIDATE_TYPES,
  TELEGRAM_BRIDGE_HUMAN_SIGNATURES,
  TELEGRAM_BRIDGE_SURFACE,
  TELEGRAM_BRIDGE_SYSTEM_SIGNATURES,
  TELEGRAM_BRIDGE_TABLES,
} from "../../lib/integration-gateway/telegram/bridge-surface";
import {
  isTelegramBridgeEnabled,
  resolveTelegramBridgeConfig,
} from "../../lib/integration-gateway/telegram/bridge-flag";

const repoRoot = process.cwd();
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf8");
const squash = (value: string): string => value.replace(/\s+/g, "");

const foundation = read(
  "supabase/migrations/20260811040000_remhaos_telegram_bridge_foundation.sql",
);
const operations = read(
  "supabase/migrations/20260811050000_remhaos_telegram_bridge_operations.sql",
);
const enableScript = read("tests/ap1/environment/enable-telegram-bridge.sql");
const boundaryScenario = read("tests/db4/09_telegram_bridge_boundary.sql");

/**
 * Комментарии — не код. Проверки «шлюз не трогает X» обязаны смотреть на
 * исполняемые строки: иначе абзац, ОБЪЯСНЯЮЩИЙ, почему мы не трогаем общий
 * журнал команд, ронял бы тест ровно за то, что он это объясняет.
 */
const executable = (sql: string): string => sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

const foundationCode = executable(foundation);
const operationsCode = executable(operations);

/**
 * Матрица поверхности моста — источник истины, а не иллюстрация.
 *
 * Урок чужой и дорогой: guardrail модуля 4 отзывал права сплошь по имени схемы,
 * выглядел исчерпывающим и пропустил четыре командные RPC, живущие в чужой
 * схеме. Поймать это было нечем — сверять было не с чем.
 */
describe("Telegram bridge surface matrix", () => {
  it("keeps every listed function in the gateway API schema with a well-formed signature", () => {
    for (const rpc of TELEGRAM_BRIDGE_SURFACE) {
      expect(rpc.schema).toBe("projectceo_gateway_api");
      expect(rpc.signature.startsWith(`${rpc.schema}.${rpc.name}(`), rpc.signature).toBe(true);
      expect(rpc.signature.endsWith(")"), rpc.signature).toBe(true);
      expect(rpc.purpose.length, rpc.name).toBeGreaterThan(0);
    }
    const names = TELEGRAM_BRIDGE_SURFACE.map((rpc) => rpc.name);
    expect(new Set(names).size, "duplicate rpc names").toBe(names.length);
  });

  /**
   * Контур определяет замок, и наоборот. Системная функция, открываемая средой,
   * означала бы, что webhook доступен человеческой сессии; человеческая
   * функция, отозванная навсегда, означала бы мост, который нельзя включить
   * даже в CI.
   */
  it("ties the circuit to the closure in both directions", () => {
    for (const rpc of TELEGRAM_BRIDGE_SURFACE) {
      expect(rpc.closure, rpc.name).toBe(
        rpc.circuit === "system" ? "revoked_from_authenticated" : "enabled_by_environment_script",
      );
    }
    expect(TELEGRAM_BRIDGE_HUMAN_SIGNATURES.length).toBeGreaterThan(0);
    expect(TELEGRAM_BRIDGE_SYSTEM_SIGNATURES.length).toBeGreaterThan(0);
  });

  /**
   * Матрица и миграция обязаны говорить одно и то же. Разойдись они — матрица
   * стала бы описанием желаемого, а не действительного, что хуже её
   * отсутствия: ей бы верили.
   */
  it("declares exactly the functions the operations migration creates", () => {
    const created = [...operations.matchAll(
      /create function projectceo_gateway_api\.([a-z_]+)\(/g,
    )].map((match) => match[1]!);
    expect(created.sort()).toEqual(TELEGRAM_BRIDGE_SURFACE.map((rpc) => rpc.name).sort());
  });

  it("grants every system signature to service_role and nothing else", () => {
    const grantBlock = operations.slice(
      operations.indexOf("grant execute on function\n  projectceo_gateway_api.consume_channel_link_intent"),
      operations.indexOf("-- Человеческий контур НЕ открывается этой миграцией"),
    );
    expect(grantBlock).toContain("to service_role");
    for (const signature of TELEGRAM_BRIDGE_SYSTEM_SIGNATURES) {
      expect(squash(grantBlock), signature).toContain(squash(signature));
    }
    // Ни одна человеческая функция не выдаётся постоянной миграцией.
    for (const signature of TELEGRAM_BRIDGE_HUMAN_SIGNATURES) {
      expect(squash(grantBlock), signature).not.toContain(squash(signature));
    }
  });

  /**
   * Скрипт среды открывает РОВНО человеческий контур. Одна лишняя строка в его
   * `grant` — и webhook становится доступен любой сессии; поэтому проверяется
   * не только присутствие, но и отсутствие.
   */
  it("lets the environment script open the human circuit and only the human circuit", () => {
    const grantBlock = enableScript.slice(
      enableScript.indexOf("grant execute on function"),
      enableScript.indexOf("do $enabled$"),
    );
    for (const signature of TELEGRAM_BRIDGE_HUMAN_SIGNATURES) {
      expect(squash(grantBlock), signature).toContain(squash(signature));
    }
    for (const signature of TELEGRAM_BRIDGE_SYSTEM_SIGNATURES) {
      expect(squash(grantBlock), signature).not.toContain(squash(signature));
    }
    // И сам скрипт обязан падать, если системный контур утёк.
    expect(enableScript).toContain("REMHAOS_TELEGRAM_BRIDGE_SYSTEM_PATH_LEAKED");
  });

  /**
   * Сценарий DB4 проверяет ВСЮ поверхность, а не выборку из неё: список,
   * который сверяется частично, рано или поздно отстанет именно на той строке,
   * которую забыли.
   */
  it("is covered signature for signature by the DB4 boundary scenario", () => {
    for (const rpc of TELEGRAM_BRIDGE_SURFACE) {
      expect(squash(boundaryScenario), rpc.signature).toContain(squash(rpc.signature));
    }
  });

  it("declares exactly the tables the foundation migration creates", () => {
    const created = [...foundation.matchAll(
      /create table projectceo_gateway\.([a-z_]+) \(/g,
    )].map((match) => match[1]!);
    expect(created.sort()).toEqual([...TELEGRAM_BRIDGE_TABLES].sort());
  });

  /**
   * Каждая таблица шлюза живёт под RLS с политикой владельца. Таблица без RLS в
   * приватной схеме — это дыра, ждущая случайного гранта.
   */
  it("puts every gateway table behind forced RLS", () => {
    for (const table of TELEGRAM_BRIDGE_TABLES) {
      expect(foundation, table).toContain(
        `alter table projectceo_gateway.${table} enable row level security`,
      );
      expect(foundation, table).toContain(
        `alter table projectceo_gateway.${table} force row level security`,
      );
      expect(squash(foundation), table).toContain(
        squash(`revoke all on table projectceo_gateway.${table}
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor`),
      );
    }
  });
});

/**
 * Инварианты A7, выраженные схемой, а не обещанием. Каждый из них проверяется
 * ещё и в базе; здесь он ловится до того, как кто-то запустит PostgreSQL.
 */
describe("Telegram bridge schema invariants", () => {
  it("stores no bot token, webhook secret or download URL", () => {
    const forbidden = [/bot_token/i, /webhook_secret/i, /download_url/i, /file_path/i];
    for (const pattern of forbidden) {
      expect(foundationCode, String(pattern)).not.toMatch(pattern);
      expect(operationsCode, String(pattern)).not.toMatch(pattern);
    }
  });

  /**
   * INV-T2. Колонки под username, телефон и отображаемое имя нет вовсе — это
   * сильнее любой проверки: связь по нестабильному признаку нельзя построить,
   * потому что её негде хранить.
   */
  it("has nowhere to store a username, a phone or a display name", () => {
    const identityTable = foundation.slice(
      foundation.indexOf("create table projectceo_gateway.channel_identity_links ("),
      foundation.indexOf("create unique index channel_identity_links_one_active_account"),
    );
    for (const pattern of [/username/i, /phone/i, /display_name/i, /first_name/i]) {
      expect(identityTable, String(pattern)).not.toMatch(pattern);
    }
    // И сам идентификатор — только десятичное число.
    expect(foundation).toContain("create domain projectceo_gateway.external_actor_id as text");
    expect(foundation).toContain("check (value ~ '^[0-9]{1,20}$')");
  });

  /** INV-T1: оба ограничения — партиальными уникальными индексами. */
  it("enforces one active chat per project and one project per active chat", () => {
    expect(squash(foundation)).toContain(squash(
      `create unique index project_channel_bindings_one_active_per_project
  on projectceo_gateway.project_channel_bindings (organization_id, project_id)
  where status = 'active'`,
    ));
    expect(squash(foundation)).toContain(squash(
      `create unique index project_channel_bindings_one_project_per_active_chat
  on projectceo_gateway.project_channel_bindings (provider, external_chat_id)
  where status = 'active'`,
    ));
  });

  /** INV-T5: TTL 10 минут держит база, а не параметр вызова. */
  it("caps the intent TTL at ten minutes in the table, not in the call", () => {
    expect(squash(foundation)).toContain(squash(
      "expires_at <= created_at + interval '10 minutes'",
    ));
    expect(foundation).toContain("nonce_digest bytea not null check (octet_length(nonce_digest) = 32)");
  });

  /**
   * INV-T4, выраженный ограничением: решённым кандидат бывает только вместе с
   * человеком и серверным временем, а системная identity человека предъявить не
   * может.
   */
  it("cannot mark a candidate resolved without a human reviewer", () => {
    expect(squash(foundation)).toContain(squash(
      `constraint project_inbox_candidates_review_check check (
    (status in ('confirmed', 'rejected'))
    = (reviewed_by_user_id is not null and reviewed_at is not null)
  )`,
    ));
  });

  /** Повтор внешнего update даёт один event; правка — новую ревизию источника. */
  it("keeps inbound idempotency structural", () => {
    expect(squash(foundation)).toContain(squash(
      "constraint channel_events_update_key unique (provider, bot_instance_id, external_update_id)",
    ));
    expect(squash(foundation)).toContain(squash(
      `create unique index channel_events_source_revision_key
  on projectceo_gateway.channel_events (binding_id, external_chat_id, external_message_id, source_revision)`,
    ));
  });

  /** Вложение до `clean` для продукта не существует. */
  it("cannot call an attachment clean without a server-computed digest", () => {
    expect(squash(foundation)).toContain(squash(
      `constraint channel_attachments_clean_check check (
    (scan_status = 'clean') <= (storage_object_key is not null and server_sha256 is not null)
  )`,
    ));
  });

  /**
   * INV-T7. Мост не касается доменных таблиц: ни одна миграция шлюза не
   * добавляет колонок в схемы модулей.
   */
  it("adds no column to any domain schema", () => {
    for (const code of [foundationCode, operationsCode]) {
      expect(code).not.toMatch(
        /alter table projectceo_(product|m3|m4)\.[a-z_]+\s+add column/i,
      );
    }
  });

  /**
   * Шлюз не двигает ревизию состояния проекта и не пишет в общий журнал команд.
   * Двигать её приходом сообщения из чата значило бы отменять человеческую
   * команду, начатую секунду назад.
   */
  it("never touches the project state revision or the shared command ledger", () => {
    for (const code of [foundationCode, operationsCode]) {
      expect(code).not.toContain("projectceo_product._complete_command");
      expect(code).not.toContain("projectceo_product.command_records");
      expect(code).not.toMatch(/update project_intelligence\.project_workflows/i);
    }
  });

  it("keeps the P0 candidate vocabulary aligned between code and schema", () => {
    for (const type of PROJECT_INBOX_CANDIDATE_TYPES) {
      expect(foundation, type).toContain(`'${type}'`);
    }
    expect(PROJECT_INBOX_CANDIDATE_TYPES).toContain("ignored");
  });
});

describe("Telegram bridge flag", () => {
  it("is off unless the environment says the literal string true", () => {
    expect(isTelegramBridgeEnabled(undefined)).toBe(false);
    expect(isTelegramBridgeEnabled("")).toBe(false);
    expect(isTelegramBridgeEnabled("1")).toBe(false);
    expect(isTelegramBridgeEnabled("TRUE")).toBe(false);
    expect(isTelegramBridgeEnabled("true")).toBe(true);
  });

  it("reports disabled and misconfigured as different states", () => {
    expect(resolveTelegramBridgeConfig({})).toEqual({
      ok: false,
      reason: "disabled",
    });
    expect(resolveTelegramBridgeConfig({
      REMHAOS_TELEGRAM_BRIDGE_ENABLED: "true",
    })).toEqual({ ok: false, reason: "misconfigured" });
  });

  /**
   * Секрет вебхука Telegram шлёт открытым заголовком. Всё, что стоит между ним
   * и подбором, — длина, поэтому короткий секрет считается отсутствующим.
   */
  it("refuses a webhook secret shorter than 32 bytes", () => {
    const base = {
      REMHAOS_TELEGRAM_BRIDGE_ENABLED: "true",
      TELEGRAM_TEST_BOT_TOKEN: "123456:token-value-not-a-real-secret",
      TELEGRAM_TEST_BOT_USERNAME: "RemHaOSTestBot",
    };
    expect(resolveTelegramBridgeConfig({
      ...base,
      TELEGRAM_TEST_WEBHOOK_SECRET: "short",
    })).toEqual({ ok: false, reason: "misconfigured" });

    const resolved = resolveTelegramBridgeConfig({
      ...base,
      TELEGRAM_TEST_WEBHOOK_SECRET: "a".repeat(48),
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    // Логическое имя экземпляра не выводится из токена: значение уходит в базу.
    expect(resolved.config.botInstanceId).toBe("telegram:remhaostestbot");
    expect(resolved.config.botInstanceId).not.toContain(resolved.config.botToken);
  });
});
