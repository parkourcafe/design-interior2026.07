import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Третий уровень защиты от возврата дефекта AP1_RUNBOOK §2b — по исходникам.
 *
 * `AP1_RUNBOOK` §4.3 ссылался на этот файл с 02.08.2026, но самого файла в
 * репозитории не было. Из-за этого миграция 20260802090000 завела три RPC с
 * `auth.uid()` в теле, а 20260810010000 повторила образец ещё в двух — и всё
 * это прошло зелёным `npm run test`. Обнаружено гейтом AP5 на живом стеке
 * 10.08.2026; здесь класс закрывается на уровне исходников.
 *
 * Почему это вообще запрещено: тела `SECURITY DEFINER` функций выполняются от
 * имени `pi_table_owner`, у которого на managed Supabase нет `USAGE` на схему
 * `auth`. Вызов падает с «permission denied for schema auth» — но только в бою,
 * потому что локальная `auth` такие права раздаёт.
 */
const migrationsDir = resolve(__dirname, "../../../supabase/migrations");
const verifyDbPath = resolve(__dirname, "verify-db.sql");

/** Миграция, впервые убравшая managed-auth из тел функций. */
const AUTHORIZATION_FIX = "20260801120000";
/** Продолжение: переписало пять функций, заведённых после первого фикса. */
const FOLLOWUP = "20260810040000_projectceo_m2_m3_request_claim_followup.sql";

/**
 * Две исторические миграции, чей текст уже неизменен. Их тела переписаны
 * миграцией FOLLOWUP; исправлять сам текст нельзя — это ломает леджер и
 * переписывает применённую историю.
 */
const SUPERSEDED_BY_FOLLOWUP = new Set([
  "20260802090000_projectceo_m2_client_review_m3_handoff.sql",
  "20260810010000_projectceo_m3_documentation_persistence.sql",
]);

/** Схемы, которые обязаны быть в охвате и у guard'а миграции, и у verify-db. */
const GUARDED_SCHEMAS = [
  "project_intelligence",
  "project_intelligence_api",
  "projectceo_foundation",
  "projectceo_api",
  "projectceo_product",
  "projectceo_product_api",
  "projectceo_read_api",
  "projectceo_m3",
  "projectceo_m3_api",
  "projectceo_m4",
  "projectceo_m4_api",
] as const;

function migrations(): readonly string[] {
  return readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
}

function read(name: string): string {
  return readFileSync(resolve(migrationsDir, name), "utf8");
}

/** Внешний ключ на managed-таблицу — это DDL, а не обращение из тела функции. */
function withoutForeignKeys(sql: string): string {
  return sql.replaceAll(/references\s+auth\.users\b/g, "references <managed-users>");
}

/**
 * Запрет адресный, а не сплошной. `auth.uid()` в RLS-политике на `public.*`
 * законен: политика вычисляется от имени вызывающей роли `authenticated`, у
 * которой доступ к managed auth есть. Ломается другое — тело SECURITY DEFINER
 * функции в приватных схемах, выполняемое от `pi_table_owner`.
 *
 * Разбор простой и достаточный для этих файлов: каждый оператор в них
 * начинается с `create` в начале строки, поэтому срез от одного такого начала
 * до следующего и есть один оператор.
 */
function statementsTargetingGuardedSchemas(sql: string): readonly string[] {
  const starts = [...sql.matchAll(/^create\s/gim)].map((match) => match.index ?? 0);
  const guarded = GUARDED_SCHEMAS.join("|");
  const target = new RegExp(
    String.raw`^create\s+(?:or\s+replace\s+)?function\s+(?:${guarded})\.`
    + String.raw`|^create\s+policy[\s\S]{0,4000}?\son\s+(?:${guarded})\.`,
    "i",
  );
  return starts
    .map((start, index) => sql.slice(start, starts[index + 1] ?? sql.length))
    .filter((statement) => target.test(statement));
}

describe("managed auth regression contract", () => {
  const later = migrations().filter((name) => name.slice(0, 14) > AUTHORIZATION_FIX);

  it("ships the follow-up migration the superseded files depend on", () => {
    expect(migrations()).toContain(FOLLOWUP);
    const followup = read(FOLLOWUP);
    expect(followup).toContain("'auth.uid()'");
    expect(followup).toContain("'project_intelligence._request_user_id()'");
    expect(followup).toContain("PROJECTCEO_MANAGED_AUTH_REFERENCE_REMAINS");
    for (const schema of GUARDED_SCHEMAS) {
      expect(followup, schema).toContain(`'${schema}'`);
    }
  });

  it("keeps the deployed-state check as wide as the migration guard", () => {
    const verify = readFileSync(verifyDbPath, "utf8");
    for (const schema of GUARDED_SCHEMAS) {
      expect(verify, schema).toContain(`'${schema}'`);
    }
  });

  it("introduces no new managed-auth actor lookup after the authorization fix", () => {
    for (const name of later) {
      // FOLLOWUP упоминает auth.uid() как строку поиска в replace() — это и есть
      // его работа. SUPERSEDED_BY_FOLLOWUP он же и переписывает.
      if (name === FOLLOWUP || SUPERSEDED_BY_FOLLOWUP.has(name)) continue;
      for (const statement of statementsTargetingGuardedSchemas(read(name))) {
        expect(statement, name).not.toMatch(/auth\.(uid|jwt)\s*\(/);
      }
    }
  });

  it("catches the two historical files it declares superseded", () => {
    // Если кто-то починит их правкой самого текста, запись здесь станет ложью:
    // список обязан описывать реальность, а не намерение.
    for (const name of SUPERSEDED_BY_FOLLOWUP) {
      const guarded = statementsTargetingGuardedSchemas(read(name));
      expect(guarded.some((statement) => /auth\.(uid|jwt)\s*\(/.test(statement)), name).toBe(true);
    }
  });

  it("references managed auth.users only from foreign keys", () => {
    for (const name of later) {
      if (name === FOLLOWUP) continue;
      for (const statement of statementsTargetingGuardedSchemas(withoutForeignKeys(read(name)))) {
        expect(statement, name).not.toMatch(/auth\.users\b/);
      }
    }
  });
});
