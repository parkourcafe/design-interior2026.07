import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../..");
const bootstrapPath = resolve(
  repoRoot,
  "tests/ap1/environment/bootstrap-disposable.zsh",
);
const rolePreconditionPath = resolve(
  repoRoot,
  "tests/ap1/environment/apply-hosted-role-precondition.sql",
);
const verifyDbPath = resolve(repoRoot, "tests/ap1/environment/verify-db.sql");

const bootstrap = readFileSync(bootstrapPath, "utf8");
const rolePrecondition = readFileSync(rolePreconditionPath, "utf8");

// Запрет адресован исполняемым строкам, а не объяснению, почему он существует.
// Комментарий, называющий исторический обход §2b, — документация; тот же текст
// как команда — дефект. Без этого разделения контрактный тест заставлял бы
// удалять именно те комментарии, ради которых файл понятен через полгода.
function withoutComments(source: string, marker: "--" | "#"): string {
  const commentLine = marker === "--" ? /^\s*--/ : /^\s*#/;
  return source
    .split("\n")
    .filter((line) => !commentLine.test(line))
    .join("\n");
}

describe("AP1 disposable bootstrap contract", () => {
  it("refuses production by ref, not by hope", () => {
    // Ref прода записан в скрипте буквально ровно ради этого отказа: строку
    // подключения человек может передать по ошибке, и скрипт обязан узнать её.
    expect(bootstrap).toContain("production_ref=ztnycrchwxqczqbyegnp");
    expect(bootstrap).toContain("AP1_PRODUCTION_TARGET_REJECTED");
    expect(bootstrap).toContain("AP1_PRODUCTION_LINK_REJECTED");
  });

  it("requires an explicit disposable confirmation before touching a hosted stand", () => {
    expect(bootstrap).toContain("AP1_CONFIRM_DISPOSABLE_REQUIRED");
    expect(bootstrap).toMatch(/AP1_CONFIRM_DISPOSABLE:-no\} != yes/);
  });

  it("bootstraps only a clean database, per the baseline guard", () => {
    // §2/§2d: baseline — замена 0001–0007, а не продолжение. Поверх legacy он
    // падает P0001; предпосылку ловим до первой миграции.
    expect(bootstrap).toContain("AP1_NOT_CLEAN_BOOTSTRAP");
    expect(bootstrap).toContain("assert_clean_bootstrap");
  });

  it("fails the stand when the migration ledger drifts", () => {
    // Гипотеза Фазы 2: новые миграции не ломают clean-bootstrap И попадают в
    // ledger. Оба расхождения — набор файлов и хеш файла — обязаны ронять
    // прогон до AP5, а не после.
    expect(bootstrap).toContain("AP1_MIGRATION_LEDGER_DIGEST_MISMATCH");
    expect(bootstrap).toContain("AP1_MIGRATION_LEDGER_SET_MISMATCH");
    expect(bootstrap).toContain("AP1_MIGRATION_LEDGER_MISMATCH");
    expect(bootstrap).toContain("sha256sum --check");
  });

  it("keeps the historical auth workaround out of the stand", () => {
    // §2b: `grant authenticated to pi_table_owner` доказывал причину сбоя и
    // после PR #60 не нужен. С ним зелёный прогон доказывает заплатку.
    expect(bootstrap).toContain("AP1_AUTH_WORKAROUND_GRANT_ABSENT");
    expect(bootstrap).toContain("AP1_AUTH_WORKAROUND_GRANT_PRESENT");
    expect(withoutComments(bootstrap, "#")).not.toMatch(
      /grant\s+authenticated\s+to\s+pi_table_owner/i,
    );
    expect(withoutComments(rolePrecondition, "--")).not.toMatch(
      /grant\s+authenticated\s+to\s+pi_table_owner/i,
    );
  });

  it("never echoes the connection string", () => {
    // AP1_DB_URL несёт пароль. Он передаётся в psql и больше никуда: ни в
    // print, ни в receipt, ни в отчёт прогона.
    const echoed = bootstrap
      .split("\n")
      .filter((line) => /\bprint\b/.test(line) && /AP1_DB_URL/.test(line));
    expect(echoed).toEqual([]);
  });

  it("applies the hosted role precondition without widening role attributes", () => {
    // §2a: не хватает именно членства (SET/INHERIT), а не прав роли. Атрибуты
    // остаются NOLOGIN NOINHERIT NOBYPASSRLS — их перепроверяет guard миграций.
    expect(rolePrecondition).toContain("nologin noinherit nobypassrls");
    expect(rolePrecondition).toContain("with inherit true, set true");
    expect(rolePrecondition).toContain("AP1_HOSTED_ROLE_PRECONDITION_INVALID");
    expect(withoutComments(rolePrecondition, "--")).not.toMatch(
      /\balter\s+role\b/i,
    );
    expect(withoutComments(rolePrecondition, "--")).not.toMatch(
      /\bcreate\s+role\s+\S+\s+(?!nologin\s+noinherit\s+nobypassrls)/i,
    );
  });

  it("models hosted managed auth on a local stand instead of trusting it", () => {
    // На локальном стеке три исторических `grant usage on schema auth` реально
    // срабатывают, потому что postgres здесь superuser. Без отзыва локальный
    // прогон доказывал бы поведение, которого на hosted нет.
    expect(bootstrap).toContain("apply-local-auth-compat.sql");
    expect(bootstrap).toMatch(/target\} == local[\s\S]{0,80}apply_local_auth_compat/);
  });

  it("keeps PostgreSQL 17 as the default expectation of the verifier", () => {
    // Параметризация нужна локальному прогону на 16. Умолчание — версия
    // hosted Supabase, и оно не должно меняться молча.
    const verifyDb = readFileSync(verifyDbPath, "utf8");
    expect(verifyDb).toContain("ap1.expected_postgres_major");
    expect(verifyDb).toMatch(/nullif\(current_setting\('ap1\.expected_postgres_major', true\), ''\)::integer,\s*\n\s*17/);
    expect(verifyDb).toContain("AP1_EXPECTED_POSTGRES_%");
  });
});
