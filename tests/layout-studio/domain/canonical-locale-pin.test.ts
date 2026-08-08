import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ADR-0007: подпись версии считается из канонической сериализации,
// отсортированной по кодовым точкам Unicode — так же, как сортирует PostgreSQL
// с C-collation (LS-011, contract:sql-c-collation-parity). localeCompare и
// Intl.Collator зависят от локали процесса: один документ дал бы разные подписи
// на разных машинах и разошёлся бы с базой. Поведенческий тест LS-011 ловит
// расхождение по факту; этот — по имени, с указанием на ADR.
const CANONICAL_SOURCES = [
  "lib/layout-studio/domain/canonical.ts",
  "lib/project-intelligence/ordering.ts",
];

describe("ADR-0007: канонизация не зависит от локали", () => {
  it("не допускает локале-чувствительные сравнения в файлах канонизации", () => {
    for (const path of CANONICAL_SOURCES) {
      const source = readFileSync(path, "utf8");
      expect(source, `${path}: см. ADR-0007`).not.toMatch(/localeCompare|Intl\.Collator/);
    }
  });

  it("держит поведенческий тест паритета LS-011 на месте", () => {
    // На ветке движка сортировка была заменена и одновременно исчез тест,
    // который бы это поймал. Удаление LS-011 — само по себе красный флаг.
    const parity = readFileSync("tests/layout-studio/domain/canonical-parity.test.ts", "utf8");
    expect(parity).toContain("sql-c-collation-parity");
  });
});
