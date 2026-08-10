import { describe, expect, it } from "vitest";

import { frozenSchema } from "@/lib/layout-studio/domain/schema";
import { canonicalSerialize, semanticHash } from "@/lib/layout-studio/domain";
import type { LayoutDocument } from "@/lib/layout-studio/domain";
import kora from "@/fixtures/layout-studio/kora-liquid-station.v0.1.json";

/**
 * Паритет подписи держится на контракте, а не на удаче.
 *
 * Канонизация сортирует ровно два вида строк: ключи объектов и идентификаторы
 * сущностей. Ключи заданы схемой (`additionalProperties: false`), а вот id
 * до 08.08.2026 могли быть любой непустой строкой — включая символы вне
 * базовой плоскости, на которых сортировка по кодовым юнитам UTF-16
 * расходится с сортировкой по кодовым точкам и с C-collation PostgreSQL.
 *
 * Вывод «на практике совпадает» держался на том, что такие id не рождаются.
 * Замечание параллельного контура принято: charset ограничен ASCII, и теперь
 * согласие трёх контрактов — нашего, их и базы — нарушить невозможно, а не
 * маловероятно.
 */
const ID_PATTERN: string = (frozenSchema as { $defs: { stableId: { pattern: string } } })
  .$defs.stableId.pattern;

describe("Контракт идентификаторов: паритет подписи по построению", () => {
  it("charset идентификаторов — только ASCII", () => {
    // Явный список разрешённого. Любое расширение шаблона за пределы ASCII
    // ломает этот тест раньше, чем разойдутся подписи.
    expect(ID_PATTERN).toBe("^[A-Za-z0-9][A-Za-z0-9._:@-]{2,127}$");
    const allowed = /^\^\[[\x20-\x7E]+\]\[[\x20-\x7E]+\]\{\d+,\d+\}\$$/;
    expect(ID_PATTERN, "шаблон содержит не-ASCII").toMatch(allowed);
  });

  it("отвергает идентификаторы вне базовой плоскости", () => {
    const re = new RegExp(ID_PATTERN, "u");
    for (const id of ["\u{10000}.astral", ".bmp", "идентификатор", "a b", "a/b"]) {
      expect(re.test(id), `принят недопустимый id ${JSON.stringify(id)}`).toBe(false);
    }
    for (const id of ["node.kora.nw", "50000000-0000-4000-8000-000000000001", "A.upper"]) {
      expect(re.test(id), `отвергнут допустимый id ${id}`).toBe(true);
    }
  });

  it("все сортируемые строки документа лежат в ASCII", () => {
    // Сортируются ключи и id; значения (label, warnings, sourceRefs) — нет,
    // поэтому кириллица в подписях безопасна и остаётся разрешённой.
    const serialized = canonicalSerialize(kora as unknown as LayoutDocument);
    const ids = [...serialized.matchAll(/"id":"([^"]*)"/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(0);
    const re = new RegExp(ID_PATTERN, "u");
    for (const id of ids) expect(re.test(id), `id вне контракта: ${id}`).toBe(true);
  });

  it("подпись эталонной фикстуры не изменилась после приведения контракта", async () => {
    expect(await semanticHash(kora as unknown as LayoutDocument)).toBe(
      "ef57708a1deb66b47454901eb9b5af83460bddb19986e116d926f3f455833a11",
    );
  });
});
