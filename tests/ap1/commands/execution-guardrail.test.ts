import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PostgresRpcClient } from "../../../lib/project-intelligence/adapters/postgres";
import type { ProjectCeoCommand } from "../../../lib/project-intelligence/delivery/projectceo/command-contract";
import { ProjectCeoCommandService } from "../../../lib/project-intelligence/delivery/projectceo/command-service";
import {
  EXECUTION_INCREMENT_1,
  EXECUTION_INCREMENT_2,
  EXECUTION_MODULE,
  EXECUTION_NOT_AUTHORIZED_COMMANDS,
  EXECUTION_PERMANENTLY_CLOSED,
  EXECUTION_V1_IMPACT,
  isExecutionModuleEnabled,
} from "../../../lib/project-intelligence/delivery/projectceo/execution-flag";

const projectId = "11111111-1111-4111-8111-111111111111";

/**
 * Guardrail модуля 4 (`REMHAOS_GUARDRAIL_DECISION_M4_FLAG.md`, подписан
 * 10.08.2026). Здесь проверяется граница приложения; граница базы — в
 * `tests/db4/38_m4_execution_guardrail.sql`. Одна без другой запрета не создаёт:
 * схема `projectceo_m4_api` отдана Data API, и до миграции `20260810070000` её
 * команды можно было звать напрямую, минуя этот сервис.
 */
describe("M4 execution guardrail", () => {
  function client(calls: string[]): PostgresRpcClient {
    return {
      schema: (schemaName) => ({
        rpc: async (functionName) => {
          calls.push(`${schemaName}.${functionName}`);
          return { data: null, error: { code: "P1104", message: "not_found" } };
        },
      }),
    };
  }

  function command(kind: ProjectCeoCommand["kind"]): ProjectCeoCommand {
    return {
      contractVersion: "projectceo-command/0.1",
      commandId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      kind,
      projectId,
      payload: {},
    } as ProjectCeoCommand;
  }

  it("treats an absent variable as closed, and only the literal string as open", () => {
    // Забыть выставить переменную должно означать «закрыто», а не «неизвестно».
    expect(isExecutionModuleEnabled(undefined)).toBe(false);
    expect(isExecutionModuleEnabled("")).toBe(false);
    // "1", "TRUE" и "yes" — самые вероятные способы включить модуль по ошибке.
    for (const near of ["1", "TRUE", "True", "yes", "on", " true"]) {
      expect(isExecutionModuleEnabled(near), near).toBe(false);
    }
    expect(isExecutionModuleEnabled("true")).toBe(true);
  });

  it("refuses every M4 command before touching the network when the flag is off", async () => {
    for (const kind of EXECUTION_MODULE) {
      const calls: string[] = [];
      const service = new ProjectCeoCommandService({
        client: client(calls),
        tokenSecret: "secret-".repeat(6),
        executionEnabled: "false",
      });
      const result = await service.execute(command(kind), `off-${kind}`);
      expect(result, kind).toMatchObject({
        status: "unavailable",
        error: { code: "operation_unavailable" },
      });
      // Главное в этой проверке — не код ответа, а тишина в сети: команда не
      // доходит ни до одного RPC, то есть отказ не зависит от базы.
      expect(calls, kind).toEqual([]);
    }
  });

  it("fails CI when any command is added to the contract without being classified", () => {
    // Тест против забывчивости (guardrail §6.1) — и он обязан ловить именно то,
    // чего нет сегодня. Проверять «каждая заявленная команда есть в контракте»
    // недостаточно: девятая команда M4, добавленная в контракт и не внесённая
    // ни в один инкремент, такую проверку прошла бы молча и оказалась бы вне
    // запрета.
    //
    // Поэтому здесь tripwire на весь контракт: любое пополнение списка команд
    // роняет тест, и человек обязан решить, относится ли новая команда к
    // модулю 4. Обновлять число можно только вместе с этим решением.
    const source = readFileSync(
      new URL(
        "../../../lib/project-intelligence/delivery/projectceo/command-contract.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const kinds = [...source.matchAll(/kind: z\.literal\("([a-z0-9_]+)"\)/g)]
      .map((match) => match[1]!);

    expect(
      kinds.length,
      "Команда добавлена или удалена в командном контракте. Отнесите её к "
      + "инкременту 1, инкременту 2 или к «не модуль 4» в execution-flag.ts, "
      + "затем обновите это число.",
    ).toBe(33);

    const declared = [...new Set([
      ...EXECUTION_INCREMENT_1,
      ...EXECUTION_INCREMENT_2,
      ...EXECUTION_V1_IMPACT,
      // DEC-034: `acknowledge_impact_truncation` — М4-команда, закрытая
      // навсегда, а не элемент V1_IMPACT (открытого множества).
      ...EXECUTION_PERMANENTLY_CLOSED,
    ])];
    // Каждая классифицированная команда действительно существует в контракте:
    // опечатка в имени иначе тихо выключила бы запрет для настоящей команды.
    for (const kind of declared) {
      expect(kinds, kind).toContain(kind);
    }
    // Инкременты не пересекаются и вместе покрывают модуль целиком.
    expect(new Set(declared).size).toBe(declared.length);
    expect(EXECUTION_MODULE.size).toBe(declared.length);
    // Было 8 — три команды инкремента 1 и пять инкремента 2. Стало 9:
    // решение владельца об усечении от 12.08.2026 добавило
    // `acknowledge_impact_truncation`, которой в классификации A6 не было.
    expect(declared.length).toBe(9);
  });

  /**
   * Инкремент 1 открыт подписью A6; из инкремента 2 отдельным GO от 12.08.2026
   * открыта одна команда — `review_change_impact` (вертикаль V1 Impact).
   * Различие живёт в коде, а не только в документе: включение модуля обязано
   * открывать ровно разрешённое и ни одной командой больше.
   */
  it("opens what is authorised and keeps the rest closed when the flag is on", async () => {
    for (const kind of EXECUTION_NOT_AUTHORIZED_COMMANDS) {
      const calls: string[] = [];
      const service = new ProjectCeoCommandService({
        client: client(calls),
        tokenSecret: "secret-".repeat(6),
        executionEnabled: "true",
      });
      const result = await service.execute(command(kind), `increment2-${kind}`);
      expect(result, kind).toMatchObject({
        status: "unavailable",
        error: { code: "operation_unavailable" },
      });
      // Отказ по неавторизованному инкременту обязан быть таким же тихим, как
      // отказ по выключенному модулю: ни одного RPC.
      expect(calls, kind).toEqual([]);
    }

    // Разрешённые команды при включённом модуле доходят до базы. Проверяется
    // именно это — не успех команды (payload здесь пустой и база ответит
    // отказом), а то, что запрет её больше не перехватывает.
    //
    // `review_change_impact` здесь наравне с инкрементом 1: после GO на V1 она
    // обязана отказывать по предпосылке (нет прогона влияния), а не по
    // авторизации. Разница видна только тем, что вызов до базы доходит.
    for (const kind of [...EXECUTION_INCREMENT_1, ...EXECUTION_V1_IMPACT]) {
      const calls: string[] = [];
      const service = new ProjectCeoCommandService({
        client: client(calls),
        tokenSecret: "secret-".repeat(6),
        executionEnabled: "true",
      });
      const result = await service.execute(command(kind), `increment1-${kind}`);
      expect(result, kind).not.toMatchObject({
        status: "unavailable",
        error: { code: "operation_unavailable" },
      });
      expect(calls.length, kind).toBeGreaterThan(0);
    }
  });

  it("does not touch commands outside the module when the flag is off", async () => {
    // Guardrail обязан быть узким: закрыв лишнее, он сломал бы M2 и M3, и это
    // выглядело бы как отказ продукта, а не как запрет одного модуля.
    const calls: string[] = [];
    const service = new ProjectCeoCommandService({
      client: client(calls),
      tokenSecret: "secret-".repeat(6),
      executionEnabled: "false",
      documentationEnabled: "true",
    });
    const result = await service.execute(command("create_invitation"), "outside");
    expect(result.status).not.toBe("unavailable");
    expect(calls.length).toBeGreaterThan(0);
  });
});
