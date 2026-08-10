import { describe, expect, it } from "vitest";

import {
  CONTRACT_VERSION_ORDER,
  CURRENT_CONTRACT_VERSION,
  isKnownContractVersion,
  knownContractVersions,
  schemaOf,
  validateAgainstDeclaredSchema,
} from "@/lib/layout-studio/domain/schema-registry";
import { validateLayoutDocument } from "@/lib/layout-studio/domain";
import type { LayoutDocument } from "@/lib/layout-studio/domain";
import simpleRoom from "@/fixtures/layout-studio/simple-room.v0.2.json";
import kora from "@/fixtures/layout-studio/kora-liquid-station.v0.2.json";

const SIMPLE = simpleRoom as unknown as LayoutDocument;

/**
 * Версии, которые когда-либо публиковались. Список только растёт.
 *
 * Это не дубликат реестра ради дубликата. Реестр — код, и его строку легко
 * удалить при рефакторинге «неиспользуемого». Здесь зафиксировано обещание:
 * где-то лежит опубликованная версия в этой модели данных, её экспорт обязан
 * открыться, и удаление читателя ломает подпись, а не просто старый файл.
 *
 * Добавлять сюда строку — можно. Удалять — нельзя никогда.
 */
const VERSIONS_THAT_MUST_STAY_READABLE = ["archidom.layout-document/0.1"] as const;

describe("Реестр версий модели документа", () => {
  it("не теряет ни одной версии, которая когда-либо публиковалась", () => {
    for (const version of VERSIONS_THAT_MUST_STAY_READABLE) {
      expect(
        isKnownContractVersion(version),
        `читатель версии ${version} удалён — опубликованные версии перестанут открываться`,
      ).toBe(true);
      expect(() => schemaOf(version)).not.toThrow();
    }
  });

  it("держит порядок версий согласованным с реестром", () => {
    // Порядок нужен миграциям черновиков: без него «на версию вперёд»
    // определить нечем.
    expect([...CONTRACT_VERSION_ORDER].sort()).toEqual([...knownContractVersions()].sort());
  });

  it("создаёт новые документы в версии, которая есть в реестре", () => {
    expect(isKnownContractVersion(CURRENT_CONTRACT_VERSION)).toBe(true);
    expect(CONTRACT_VERSION_ORDER.at(-1)).toBe(CURRENT_CONTRACT_VERSION);
  });
});

describe("Проверка идёт против версии, объявленной документом", () => {
  it("принимает существующие фикстуры — каждую по её версии", () => {
    // Фикстуры редактора несут форму 0.2 (linear_proxy, полигональные зоны,
    // catalogKey); их 0.1-предшественники остаются валидными под 0.1.
    for (const fixture of [simpleRoom, kora]) {
      const result = validateAgainstDeclaredSchema(fixture);
      expect(result.valid, JSON.stringify(result.issues)).toBe(true);
      expect(result.version).toBe("archidom.layout-document/0.2");
    }
  });

  it("сообщает, против какой версии проверял", () => {
    expect(validateAgainstDeclaredSchema(SIMPLE).version).toBe(CURRENT_CONTRACT_VERSION);
  });

  it("отклоняет документ без объявленной версии", () => {
    const { contractVersion: _dropped, ...withoutVersion } = SIMPLE as unknown as Record<
      string,
      unknown
    >;
    const result = validateAgainstDeclaredSchema(withoutVersion);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("CONTRACT_VERSION_MISSING");
    expect(result.version).toBeNull();
  });

  it("отклоняет незнакомую версию, а не читает её текущими правилами", () => {
    // Молчаливый откат к текущей схеме означал бы, что документ из будущего
    // «почти работает» — и расхождение всплывёт уже после публикации.
    const fromFuture = { ...structuredClone(SIMPLE), contractVersion: "archidom.layout-document/9.9" };
    const result = validateAgainstDeclaredSchema(fromFuture);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("CONTRACT_VERSION_UNKNOWN");
  });

  it("не путает версию с любой другой строкой", () => {
    for (const bogus of ["", "0.1", "layout-document/0.1", 1, null, {}]) {
      const result = validateAgainstDeclaredSchema({ ...structuredClone(SIMPLE), contractVersion: bogus });
      expect(result.valid, `принята версия ${JSON.stringify(bogus)}`).toBe(false);
    }
  });

  it("по-прежнему ловит нарушения самой схемы, а не только версию", () => {
    const broken = structuredClone(SIMPLE) as unknown as Record<string, unknown>;
    broken.walls = [{ id: "wall.broken" }];
    const result = validateAgainstDeclaredSchema(broken);
    expect(result.valid).toBe(false);
    expect(result.issues.every((issue) => issue.severity === "blocking")).toBe(true);
  });

  it("не ломает общий валидатор документа", () => {
    // validateLayoutDocument ходит сюда же; проверка, что связка цела.
    expect(validateLayoutDocument(SIMPLE).valid).toBe(true);
  });
});
