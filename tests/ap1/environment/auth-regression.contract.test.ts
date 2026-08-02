import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Защита от повторения дефекта, который стоил дня пилота AP1 (01.08.2026).
 *
 * Что случилось: `_authorize_project_human` — SECURITY DEFINER с владельцем
 * `pi_table_owner`, то есть выполняется от имени этой роли. Внутри она звала
 * `auth.uid()`. На управляемом Supabase схема `auth` принадлежит
 * `supabase_admin`, а `pi_table_owner` доступа к ней не имеет — любой
 * аутентифицированный вызов падал с `permission denied for schema auth`.
 *
 * Почему не заметили раньше: миграции пытались выдать грант
 * `grant usage on schema auth to pi_table_owner` — в трёх местах. Но `postgres`
 * в Supabase владеет схемой `auth` без права передачи, и PostgreSQL в таком
 * случае отвечает `WARNING: no privileges were granted`, а НЕ ошибкой.
 * Миграция рапортовала об успехе, грант не применялся, дефект был невидим для
 * билда, тестов и самого факта успешного применения миграций.
 *
 * Исправлено в 20260801120000_projectceo_request_claim_authorization.sql:
 * функции читают подписанные claims PostgREST вместо обращения к схеме `auth`.
 *
 * Эти тесты не дают тихо вернуть проблему обратно.
 */

const repoRoot = resolve(__dirname, "../../..");
const migrationsDir = resolve(repoRoot, "supabase/migrations");

/** Миграция, после которой обращения к схеме `auth` из PI-функций запрещены. */
const AUTH_FIX_VERSION = "20260801120000";

/** Схемы, чьи функции принадлежат pi_table_owner и не видят схему `auth`. */
const PI_SCHEMAS = [
  "project_intelligence",
  "project_intelligence_api",
  "projectceo_foundation",
  "projectceo_api",
  "projectceo_product",
  "projectceo_product_api",
  "projectceo_read_api",
  "projectceo_m4",
  "projectceo_m4_api",
];

/**
 * Инертные гранты, унаследованные от до-фиксовых миграций. Удалить их нельзя —
 * `AGENTS.md` требует неизменности применённых timestamped-миграций. Но набор
 * не должен расти: каждый такой грант выглядит как выданный доступ, хотя молча
 * ничего не делает.
 */
const KNOWN_INERT_AUTH_GRANTS = [
  "20260716072000_project_intelligence_core.sql",
  "20260717090000_projectceo_foundation_access.sql",
  "20260717092000_projectceo_foundation_integration_hardening.sql",
];

function migrationFiles(): string[] {
  return readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
}

function versionOf(file: string): string {
  return file.split("_")[0] ?? "";
}

/** Файлы миграций, созданные после исправления авторизации. */
function migrationsAfterAuthFix(): string[] {
  return migrationFiles().filter((f) => {
    const v = versionOf(f);
    // Историческая нумерация (0001…0007) заведомо старше.
    return v.length >= 14 && v > AUTH_FIX_VERSION;
  });
}

describe("ProjectCEO authorization must not regress to the auth schema", () => {
  it("no migration after the fix references auth.uid/auth.jwt/auth.users inside a ProjectCEO schema", () => {
    const offenders: string[] = [];

    for (const file of migrationsAfterAuthFix()) {
      const sql = readFileSync(resolve(migrationsDir, file), "utf8");
      // Комментарии выкидываем: упоминание в пояснении — не обращение.
      const code = sql.replace(/--[^\n]*/g, "");
      // Без завершающего \b: после `uid()` стоит `)`, а он не даёт границы слова,
      // из-за чего `\b` в конце молча ломал бы всю проверку.
      const touchesAuth = /\bauth\.(uid\s*\(|jwt\s*\(|users\b)/.test(code);
      const touchesPiSchema = PI_SCHEMAS.some((s) => code.includes(`${s}.`));
      if (touchesAuth && touchesPiSchema) offenders.push(file);
    }

    expect(
      offenders,
      "Функции ProjectCEO принадлежат pi_table_owner и не видят схему auth на "
      + "управляемом Supabase. Используйте project_intelligence._request_user_id() "
      + "и _request_jwt() из миграции 20260801120000 вместо auth.uid()/auth.jwt().",
    ).toEqual([]);
  });

  it("the set of inert `grant usage on schema auth` statements does not grow", () => {
    const granting = migrationFiles().filter((file) => {
      const sql = readFileSync(resolve(migrationsDir, file), "utf8").replace(/--[^\n]*/g, "");
      return /grant\s+usage\s+on\s+schema\s+auth\s+to/i.test(sql);
    });

    expect(
      granting,
      "Такой грант молча не применяется: схема auth принадлежит supabase_admin, "
      + "postgres не имеет права передачи, и PostgreSQL отвечает WARNING вместо "
      + "ошибки. Новый грант создаст ложное впечатление выданного доступа.",
    ).toEqual(KNOWN_INERT_AUTH_GRANTS);
  });

  it("the authorization fix migration is present and defines both claim readers", () => {
    const file = migrationFiles().find((f) => f.startsWith(AUTH_FIX_VERSION));
    expect(file, "миграция исправления авторизации отсутствует").toBeDefined();

    const sql = readFileSync(resolve(migrationsDir, file as string), "utf8");
    expect(sql).toContain("project_intelligence._request_user_id()");
    expect(sql).toContain("project_intelligence._request_jwt()");
    // Читаем именно подписанные claims шлюза, а не схему auth.
    expect(sql).toContain("request.jwt.claim.sub");
  });
});
