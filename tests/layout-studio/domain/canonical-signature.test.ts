import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { semanticHash } from "@/lib/layout-studio/domain";
import type { LayoutDocument } from "@/lib/layout-studio/domain";
import kora from "@/fixtures/layout-studio/kora-liquid-station.v0.1.json";

const KORA = kora as unknown as LayoutDocument;

/**
 * ADR-001: способ вычисления подписи заморожен.
 *
 * Подпись (semanticHash) — свойство документа, а не машины, на которой он
 * открыт. A4 §5 требует, чтобы опубликованная версия читалась вечно; это же
 * относится к её подписи: один и тот же документ обязан давать один и тот же
 * хеш сегодня, через год и на любой машине.
 *
 * Хеш KORA-фикстуры закреплён здесь как контрольная точка. Он уже фигурирует
 * в записанных доказательствах приёмки (прогон r15, файлы
 * browser-acceptance/evidence/layout-ef57708a…): изменение способа канонизации
 * сделало бы их недействительными. Если этот тест упал — вы поменяли
 * канонизацию, и это запрещено без нового ADR.
 */
const KORA_PINNED_HASH =
  "ef57708a1deb66b47454901eb9b5af83460bddb19986e116d926f3f455833a11";

describe("ADR-001: подпись версии заморожена", () => {
  it("хеш KORA-фикстуры совпадает с закреплённым", async () => {
    expect(await semanticHash(KORA)).toBe(KORA_PINNED_HASH);
  });

  it("подпись не зависит от порядка сущностей в файле", async () => {
    const shuffled = structuredClone(KORA);
    shuffled.walls = [...shuffled.walls].reverse();
    shuffled.nodes = [...shuffled.nodes].reverse();
    shuffled.openings = [...shuffled.openings].reverse();
    shuffled.objects = [...shuffled.objects].reverse();
    shuffled.materials = [...shuffled.materials].reverse();
    expect(await semanticHash(shuffled)).toBe(KORA_PINNED_HASH);
  });

  it("подпись не зависит от порядка ключей объекта", async () => {
    const flipped = Object.fromEntries(
      Object.entries(KORA).reverse(),
    ) as unknown as LayoutDocument;
    expect(await semanticHash(flipped)).toBe(KORA_PINNED_HASH);
  });

  it("содержательное изменение меняет подпись", async () => {
    const edited = structuredClone(KORA);
    edited.floor.clearHeightMm += 1;
    expect(await semanticHash(edited)).not.toBe(KORA_PINNED_HASH);
  });

  it("канонизация не использует локалезависимых сравнений", () => {
    // localeCompare зависит от локали и версии ICU: один документ давал бы
    // разные подписи на разных машинах. Запрет статический — в файле
    // канонизации этого вызова быть не должно.
    const raw = readFileSync(
      join(process.cwd(), "lib/layout-studio/domain/canonical.ts"),
      "utf8",
    );
    // Сверяем исполняемый код, а не комментарии: комментарий вправе называть
    // запрещённый вызов, объясняя, почему он запрещён.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(source).not.toMatch(/localeCompare/);
  });
});
