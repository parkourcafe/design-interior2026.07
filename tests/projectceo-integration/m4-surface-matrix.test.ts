import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  M4_INCREMENT_1_SIGNATURES,
  M4_NON_COMMAND_FUNCTIONS,
  M4_REVOKED_SIGNATURES,
  M4_SURFACE,
  M4_SURFACE_COMMANDS,
  M4_V1_IMPACT_SIGNATURES,
} from "../../lib/project-intelligence/delivery/projectceo/m4-surface";
import {
  EXECUTION_INCREMENT_1,
  EXECUTION_INCREMENT_2,
  EXECUTION_MODULE,
  EXECUTION_NOT_AUTHORIZED_COMMANDS,
  EXECUTION_PERMANENTLY_CLOSED,
  EXECUTION_V1_IMPACT,
} from "../../lib/project-intelligence/delivery/projectceo/execution-flag";

const repoRoot = process.cwd();
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf8");
const squash = (value: string): string => value.replace(/\s+/g, "");

/**
 * Матрица поверхности M4 — источник истины, а не иллюстрация.
 *
 * Урок, ради которого она написана: guardrail `20260810070000` отзывал права
 * сплошь по схеме `projectceo_m4_api` и выглядел исчерпывающим, а четыре
 * командные RPC модуля живут в продуктовой схеме и остались открытыми. Ни один
 * тест этого поймать не мог — сверять было не с чем.
 */
describe("M4 surface matrix", () => {
  it("covers every command of both increments, and nothing else", () => {
    expect([...M4_SURFACE_COMMANDS].sort()).toEqual([...EXECUTION_MODULE].sort());
    expect(M4_SURFACE.filter((row) => row.increment === 1).map((row) => row.command).sort())
      .toEqual([...EXECUTION_INCREMENT_1].sort());
    // Во втором инкременте живут и команды, которых A6 не классифицировал
    // вовсе: `acknowledge_impact_truncation` появилась вместе с решением об
    // усечении (PR #94) и осталась в той же строке матрицы — но DEC-034
    // закрыла её НАВСЕГДА, поэтому она больше не элемент `EXECUTION_V1_IMPACT`
    // (открытого множества), а элемент `EXECUTION_PERMANENTLY_CLOSED`.
    expect(M4_SURFACE.filter((row) => row.increment === 2).map((row) => row.command).sort())
      .toEqual([...new Set([
        ...EXECUTION_INCREMENT_2,
        ...EXECUTION_V1_IMPACT,
        ...EXECUTION_PERMANENTLY_CLOSED,
      ])].sort());
  });

  /**
   * Состояние «включено» определяется АВТОРИЗАЦИЕЙ, а не номером инкремента.
   * До 12.08 это было одно и то же, и правило можно было писать по номеру;
   * GO на V1 их развёл: `review_change_impact` осталась во втором инкременте
   * по классификации A6, но открыта отдельным решением владельца.
   */
  it("states one honest off-state and an on-state that matches the authorisation", () => {
    for (const row of M4_SURFACE) {
      expect(row.offState, row.command).toBe("module_disabled");
      const authorized = row.increment === 1
        || (EXECUTION_V1_IMPACT as readonly string[]).includes(row.command);
      expect(row.onState, row.command).toBe(
        authorized ? "precondition_driven" : "increment_not_authorized",
      );
      expect(row.rpcs.length, row.command).toBeGreaterThan(0);
      for (const rpc of row.rpcs) {
        expect(rpc.signature.startsWith(`${rpc.schema}.${rpc.name}(`), rpc.signature).toBe(true);
        expect(["m4_only", "shared_schema"]).toContain(rpc.sharing);
        expect(["revoked_from_authenticated", "enabled_by_environment_script"])
          .toContain(rpc.closure);
      }
    }
  });

  /**
   * Ни одна RPC НЕАВТОРИЗОВАННОЙ команды не может быть открываемой средой. Это
   * и есть граница между «модуль выключен» и «не авторизовано»: первое
   * снимается флагом, второе не снимается ничем, кроме решения владельца —
   * ровно такого, каким открыт V1.
   */
  it("never lets an unauthorised RPC be openable by any environment", () => {
    const closed = M4_SURFACE.filter(
      (entry) => EXECUTION_NOT_AUTHORIZED_COMMANDS.has(entry.command),
    );
    // Список не должен опустеть незаметно: пустой фильтр прошёл бы молча и
    // перестал бы что-либо охранять. Было 4 (четыре команды V2/V3) — DEC-034
    // добавила пятую: `acknowledge_impact_truncation`, закрытую навсегда.
    expect(closed.length).toBe(5);
    for (const row of closed) {
      for (const rpc of row.rpcs) {
        expect(rpc.closure, rpc.signature).toBe("revoked_from_authenticated");
      }
    }
  });

  /**
   * Матрица и миграция обязаны говорить одно и то же. Разойдись они — матрица
   * стала бы описанием желаемого, а не действительного, что хуже её отсутствия:
   * ей бы верили.
   */
  it("matches the distribution guardrail migration signature for signature", () => {
    const migration = read(
      "supabase/migrations/20260811020000_projectceo_m4_distribution_guardrail.sql",
    );
    const revokeBlock = migration.slice(
      migration.indexOf("revoke execute on function"),
      migration.indexOf("from authenticated;"),
    );
    const revokedInMigration = revokeBlock
      .split("\n")
      .map((line) => line.trim().replace(/,$/, ""))
      .filter((line) => line.includes("(") && line.includes("."));
    // Продуктовая схема — единственная, где отзыв поимённый: схему
    // `projectceo_m4_api` закрывает сплошной revoke из `20260810070000`.
    const productSignatures = M4_SURFACE
      .flatMap((row) => row.rpcs)
      .filter((rpc) => rpc.schema === "projectceo_product_api")
      .map((rpc) => rpc.signature);
    expect(revokedInMigration.length).toBe(productSignatures.length);
    for (const signature of productSignatures) {
      expect(squash(revokeBlock)).toContain(squash(signature));
    }
  });

  /**
   * Скриптов среды два, и каждый обязан открывать ровно свой набор. Общий
   * список здесь не годился бы: скрипт V1, открывший заодно инкремент 1, прошёл
   * бы такую проверку молча.
   */
  it.each([
    ["tests/ap1/environment/enable-m4-increment-1.sql", M4_INCREMENT_1_SIGNATURES],
    ["tests/ap1/environment/enable-m4-v1-impact.sql", M4_V1_IMPACT_SIGNATURES],
  ] as const)("keeps %s opening exactly its own signatures", (path, expected) => {
    const enable = read(path);
    const grantBlock = enable.slice(
      enable.indexOf("grant execute on function"),
      enable.indexOf("to authenticated;"),
    );
    const granted = grantBlock
      .split("\n")
      .map((line) => line.trim().replace(/,$/, ""))
      .filter((line) => line.includes("(") && line.includes(".") && !line.startsWith("--"));
    expect(expected.length).toBeGreaterThan(0);
    expect(granted.length).toBe(expected.length);
    for (const signature of expected) {
      expect(squash(grantBlock), signature).toContain(squash(signature));
    }
    // Ни одна отозванная навсегда сигнатура не имеет права оказаться в гранте.
    for (const signature of M4_REVOKED_SIGNATURES) {
      expect(squash(grantBlock), signature).not.toContain(squash(signature));
    }
    // И ни один скрипт не открывает чужой набор.
    const foreign = path.includes("increment-1")
      ? M4_V1_IMPACT_SIGNATURES
      : M4_INCREMENT_1_SIGNATURES;
    for (const signature of foreign) {
      expect(squash(grantBlock), signature).not.toContain(squash(signature));
    }
  });

  /**
   * Производственный выключатель (DEC-033/034) открывает вертикаль по
   * собственному списку сигнатур, живущему в базе. Разойдись он с матрицей —
   * и включение в production открыло бы не то, что вертикаль: меньше — и
   * архитектор упрётся в отозванное право на живом проекте, больше — и
   * откроется команда, которой никто не разрешал.
   *
   * Читает НЕ исходную (`20260812030000`, неизменяемую), а корректирующую
   * миграцию (`20260813010000`, DEC-034): `_v1_impact_signatures()`
   * переопределена там (`create or replace function`) — список сократился с
   * трёх дверей до двух, `acknowledge_impact_truncation` больше не входит.
   * Читать исходный файл значило бы проверять текст, а не фактическое
   * поведение живой базы.
   *
   * Скрипт среды такой же список уже сверяет (выше). Здесь тот же контроль для
   * механизма, которым открывают по-настоящему.
   */
  it("keeps the production switch opening exactly the corrected V1 signatures", () => {
    const migration = read(
      "supabase/migrations/20260813010000_projectceo_m4_v1_impact_dec034_correction.sql",
    );
    const definition = migration.slice(
      migration.indexOf("create or replace function projectceo_m4._v1_impact_signatures()"),
    );
    const listBlock = definition.slice(
      definition.indexOf("select array["),
      definition.indexOf("];"),
    );
    const listed = listBlock
      .split("\n")
      .map((line) => line.trim().replace(/,$/, "").replace(/^'|'$/g, ""))
      .filter((line) => line.includes("(") && line.includes("."));

    expect(listed.length).toBe(M4_V1_IMPACT_SIGNATURES.length);
    for (const signature of M4_V1_IMPACT_SIGNATURES) {
      expect(squash(listBlock), signature).toContain(squash(signature));
    }
    // Ни инкремент 1, ни отозванные навсегда команды выключатель не трогает.
    for (const signature of [...M4_INCREMENT_1_SIGNATURES, ...M4_REVOKED_SIGNATURES]) {
      expect(squash(listBlock), signature).not.toContain(squash(signature));
    }
  });

  /**
   * Сценарий DB4 сверяет матрицу с настоящей базой, и делать это он может
   * только по собственному списку — SQL не импортирует TypeScript. Значит
   * списка два, и разойтись они не имеют права.
   */
  it("keeps the DB4 classification scenario mirroring the matrix", () => {
    const scenario = read("tests/db4/08_m4_surface_classification.sql");
    const listed = [...scenario.matchAll(/'([a-z0-9_]+\.[a-z0-9_]+\([^']*\))'/g)]
      .map((match) => match[1]!);
    expect([...new Set(listed)].sort()).toEqual(
      [...new Set(M4_SURFACE.flatMap((row) => row.rpcs).map((rpc) => rpc.signature))].sort(),
    );
    for (const name of M4_NON_COMMAND_FUNCTIONS) {
      expect(scenario, name).toContain(`'${name}'`);
    }
  });

  /**
   * Адаптеры зовут только то, что классифицировано. Новый вызов
   * `projectceo_m4_api.*` без строки в матрице роняет этот тест — то есть новая
   * RPC модуля не может появиться незамеченной.
   */
  it("classifies every projectceo_m4_api call the adapters make", () => {
    const adapter = read("lib/project-intelligence/adapters/postgres/execution.ts");
    const called = [...adapter.matchAll(/"projectceo_m4_api",\s*\n?\s*"([a-z_]+)"/g)]
      .map((match) => match[1]!);
    const classified = new Set([
      ...M4_SURFACE.flatMap((row) => row.rpcs)
        .filter((rpc) => rpc.schema === "projectceo_m4_api")
        .map((rpc) => rpc.name),
      ...M4_NON_COMMAND_FUNCTIONS,
    ]);
    expect(called.length).toBeGreaterThan(0);
    for (const name of called) expect([...classified]).toContain(name);
  });
});
