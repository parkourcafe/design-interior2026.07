import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../..");
const scriptPath = resolve(repoRoot, "tests/ap1/environment/bootstrap-disposable.zsh");
const script = readFileSync(scriptPath, "utf8");

// Запреты ниже адресованы исполняемым строкам. Объяснение того, почему грант
// не нужен, — это комментарий и обязано быть разрешено; иначе документировать
// границу становится дороже, чем её нарушить.
const executableScript = script
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

// Поведенческая половина требует zsh. В джобе `gates` он ставится тем же шагом,
// что и в джобах базы; у разработчика на macOS он есть по умолчанию. Если его
// всё-таки нет — тесты пропускаются явно, а не притворяются пройденными.
const zshAvailable = spawnSync("zsh", ["--version"], { encoding: "utf8" }).status === 0;

function runScript(args: string[], env: Record<string, string> = {}) {
  return spawnSync("zsh", [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("AP1 bootstrap-манифест одноразового стенда", () => {
  it("в CI zsh обязан быть: пропуск здесь — это семь несработавших проверок", () => {
    // Без этой строки `describe.skipIf` ниже деградирует молча: уберут шаг
    // установки zsh из джобы `gates` — и поведенческая половина исчезнет из
    // прогона, оставив зелёный отчёт. Ровно так уже было с AP1_RUNBOOK §4.3
    // п.3: документ описывал защиту, которой не существовало.
    // `CI=""` (переменная есть, но пустая) — тоже CI: пустая строка falsy, и
    // проверка через if (process.env.CI) молча выключалась бы ровно там, где
    // должна сработать. Сравнение с undefined закрывает эту щель.
    if (process.env.CI !== undefined) {
      expect(zshAvailable, "zsh недоступен на раннере — установи его в джобе").toBe(true);
    }
  });

  it("отказывается работать рядом с production ref", () => {
    // Значение зашито литералом, а не читается из env: параметр, которым можно
    // переопределить защиту от прода, защитой не является.
    expect(script).toContain("readonly PRODUCTION_PROJECT_REF=ztnycrchwxqczqbyegnp");
    expect(script).toContain("AP1_PRODUCTION_REF_REJECTED");
  });

  it("берёт порядок применения из реестра, а не из содержимого папки", () => {
    // Разница принципиальная: «применить всё из папки» и «применить цепочку
    // реестра» расходятся ровно в тот момент, когда в папке появляется лишний
    // или переименованный файл — то есть когда проверка и нужна.
    expect(script).toContain("migration-ledger.sha256");
    expect(script).toContain("AP1_LEDGER_FOLDER_MISMATCH");
    expect(script).toContain("sha256sum --check");
    expect(script).toContain("AP1_LEDGER_DIGEST_MISMATCH");
  });

  it("готовит роли pi_* с членством inherit/set до миграций", () => {
    for (const role of ["pi_table_owner", "pi_human_executor", "pi_worker_executor"]) {
      expect(script).toContain(`grant ${role}`);
    }
    expect(script).toContain("with inherit true, set true");
    expect(script).toContain("AP1_BOOTSTRAP_ROLE_MEMBERSHIP_INVALID");
  });

  it("не возвращает исторический обходной грант auth", () => {
    expect(executableScript).not.toMatch(/grant\s+authenticated\s+to\s+pi_table_owner/i);
    expect(executableScript).not.toMatch(/grant\s+usage\s+on\s+schema\s+auth/i);
  });

  it("проверяет отсутствие обходного гранта §2b в каждом прогоне", () => {
    // ТЗ Фазы 1 ч.2 §4.3: вердикт по блокеру 92060e3 засчитывается ТОЛЬКО
    // вместе со строкой AP1_AUTH_WORKAROUND_GRANT_ABSENT того же прогона —
    // иначе зелёный стенд не отличим от стенда, где авторизацию держит
    // заплатка `grant authenticated to pi_table_owner`.
    // Именно MEMBER: голый grant без `with inherit true` даёт членство,
    // невидимое для USAGE у NOINHERIT-роли — заплатка прошла бы проверку.
    expect(script).toContain("pg_has_role('pi_table_owner', 'authenticated', 'MEMBER')");
    expect(script).toContain("AP1_AUTH_WORKAROUND_GRANT_PRESENT");
    expect(script).toContain("AP1_AUTH_WORKAROUND_GRANT_ABSENT");
  });

  it("прогоняет постусловия базы и поверхности теми же файлами, что и AP1/AP5", () => {
    expect(script).toContain("tests/ap1/environment/verify-db.sql");
    expect(script).toContain("tests/ap1/environment/verify-runtime.mjs");
    expect(script).toContain("tests/ap1/environment/apply-local-auth-compat.sql");
  });

  it("не включает модули: это отдельные действия среды по DEC-029", () => {
    // Упоминание в шапке — объяснение границы, вызов — расширение полномочий
    // скрипта. Ловится именно вызов.
    expect(script).not.toMatch(/psql_run[a-z_]*\s+[^\n]*enable-m[34]/);
  });

  it("создаёт только auth-личности и требует подтверждения одноразовости", () => {
    expect(script).toContain("AP1_CONFIRM_DISPOSABLE=yes");
    expect(script).toContain("provision:ap1");
    // Членства раздаёт invitation-поток от лица owner: human operations через
    // service role запрещены инвариантом AGENTS.md.
    expect(script).not.toMatch(/project_memberships|organization_members/);
  });

  it("фильтрует секреты во всём выводе внешних команд", () => {
    expect(script).toContain("redact()");
    expect(script).toContain("credential line redacted");
    expect(script).toMatch(/supabase_cli start[^\n]*\|\s*redact/);
  });

  it("печатает частичный прогон отдельным итогом, а не как готовый стенд", () => {
    expect(script).toContain("AP1_BOOTSTRAP_DB_ONLY");
    expect(script).toContain("AP1_BOOTSTRAP_OK");
    expect(script).toContain("Стендом пилота такой прогон не является.");
  });

  describe.skipIf(!zshAvailable)("исполнение", () => {
    it("проходит синтаксическую проверку zsh", () => {
      const result = spawnSync("zsh", ["-n", scriptPath], { encoding: "utf8" });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    });

    it("печатает справку и выходит нулём", () => {
      const result = runScript(["--help"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("--target local|hosted");
    });

    it("падает, когда production ref пришёл переменной окружения", () => {
      const result = runScript(["--target", "hosted"], {
        SOME_UNRELATED_URL: "postgresql://u:p@db.ztnycrchwxqczqbyegnp.supabase.co:5432/postgres",
      });
      expect(result.status).toBe(65);
      expect(result.stderr).toContain("AP1_PRODUCTION_REF_REJECTED");
      expect(result.stderr).toContain("SOME_UNRELATED_URL");
    });

    it("падает, когда production ref пришёл аргументом", () => {
      const result = runScript(["--target=ztnycrchwxqczqbyegnp"]);
      expect(result.status).toBe(65);
      expect(result.stderr).toContain("AP1_PRODUCTION_REF_REJECTED");
    });

    it("ловит production ref без учёта регистра — DNS регистронезависим", () => {
      // DB.ZTNYCRCHWXQCZQBYEGNP.SUPABASE.CO резолвится в тот же прод (RFC 4343),
      // а libpq имя не нормализует. Guard, ловящий только нижний регистр,
      // отвечал бы утвердительным «не найден» на строку, ведущую ровно туда же
      // (внешняя проверка 24.08.2026).
      const viaEnvironment = runScript(["--target", "hosted"], {
        SOME_URL: "postgresql://u:p@DB.ZTNYCRCHWXQCZQBYEGNP.SUPABASE.CO:5432/postgres",
      });
      expect(viaEnvironment.status).toBe(65);
      expect(viaEnvironment.stderr).toContain("AP1_PRODUCTION_REF_REJECTED");

      const viaArgument = runScript(["--target=ZTNYCRCHWXQCZQBYEGNP"]);
      expect(viaArgument.status).toBe(65);
      expect(viaArgument.stderr).toContain("AP1_PRODUCTION_REF_REJECTED");
    });

    it("не печатает пароль из неизвестного аргумента", () => {
      // Спутать `AP1_DB_URL=...` с позиционным аргументом — реалистичная
      // ошибка оператора. Ветка «неизвестный аргумент» обязана прогнать
      // значение через redact, а не отдать пароль в лог CI дословно.
      const result = runScript(["postgresql://postgres:s3cr3t-password@db.example.test:5432/postgres"]);
      expect(result.status).toBe(64);
      expect(result.stderr).toContain("AP1_BOOTSTRAP_UNKNOWN_ARGUMENT");
      expect(result.stderr).not.toContain("s3cr3t-password");
      expect(result.stderr).toContain("[redacted]");
    });

    it("для --target local без AP1_TEST_PASSWORD отказывает на предусловиях, а не после стека", () => {
      // usage первой редакции утверждал «для local переменные не нужны», а
      // provision_identities требует пароль сам — падение приходило на
      // предпоследнем шаге, ПОСЛЕ старта стека и 54 миграций: минуты работы
      // ради причины, которую можно было назвать сразу (внешняя проверка
      // 24.08.2026). --db-only и --skip-identities пароль не требуют — до
      // создания личностей эти режимы не доходят.
      const result = runScript(["--target", "local"], { AP1_TEST_PASSWORD: "" });
      // 64 — дошли до проверки пароля; 69 — на этой машине нет docker, и
      // предусловие сработало раньше. Оба исхода — отказ на предусловиях,
      // стек не стартовал.
      expect([64, 69]).toContain(result.status);
      if (result.status === 64) {
        expect(result.stderr).toContain("AP1_TEST_PASSWORD");
      }
    });

    it("требует явный target", () => {
      const result = runScript([]);
      expect(result.status).toBe(64);
      expect(result.stderr).toContain("AP1_BOOTSTRAP_TARGET_REQUIRED");
    });

    it("отвергает неизвестный аргумент, а не игнорирует его", () => {
      const result = runScript(["--target", "hosted", "--force"]);
      expect(result.status).toBe(64);
      expect(result.stderr).toContain("AP1_BOOTSTRAP_UNKNOWN_ARGUMENT");
    });

    it("называет недостающие переменные стенда поимённо", () => {
      const result = runScript(["--target", "hosted"], {
        AP1_DB_URL: "",
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
        AP1_TEST_PASSWORD: "",
      });
      expect(result.status).toBe(64);
      expect(result.stderr).toContain("AP1_BOOTSTRAP_ENV_MISSING");
      expect(result.stderr).toContain("AP1_DB_URL");
    });
  });
});
