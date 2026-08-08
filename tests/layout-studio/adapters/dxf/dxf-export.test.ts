import { describe, expect, it } from "vitest";

import { exportLayoutToDxf, asciiLabel } from "@/lib/layout-studio/adapters/dxf/dxf-export";
import { LayoutExportService } from "@/lib/layout-studio/application/export-service";
import { MemoryLayoutRepository } from "@/lib/layout-studio/adapters/local/memory-layout-repository";
import { deriveLayout, type LayoutDocument } from "@/lib/layout-studio/domain";
import koraFixture from "@/fixtures/layout-studio/kora-liquid-station.v0.1.json";

import { makeSimpleRoom } from "../../application/layout-test-fixture";

/**
 * DXF — столп «без лицензий» (§8.3): файл обязан читаться у подрядчика.
 * Проверяется не «похожесть на DXF», а конкретный контракт формата R12:
 * парность групповых кодов, порядок секций, слои, геометрия в миллиметрах
 * и провенанс версии в комментариях.
 */

const CONTEXT = {
  versionId: "V1",
  semanticHash: "sha256:" + "ab".repeat(32),
};

function dxfFor(document: LayoutDocument): string {
  return exportLayoutToDxf(document, deriveLayout(document), CONTEXT);
}

/** Мини-читалка DXF: пары (код, значение) в порядке файла. */
function pairs(dxf: string): Array<[number, string]> {
  const lines = dxf.split("\r\n");
  // Файл оканчивается CRLF → последний элемент пуст.
  expect(lines.at(-1)).toBe("");
  lines.pop();
  expect(lines.length % 2).toBe(0);
  const result: Array<[number, string]> = [];
  for (let index = 0; index < lines.length; index += 2) {
    const code = Number(lines[index]);
    expect(Number.isInteger(code), `код группы в строке ${index}: ${lines[index]}`).toBe(true);
    result.push([code, lines[index + 1]!]);
  }
  return result;
}

describe("DXF R12: структура файла", () => {
  it("держит порядок секций HEADER → TABLES → ENTITIES → EOF и парность кодов", () => {
    const parsed = pairs(dxfFor(makeSimpleRoom()));
    const sections = parsed
      .map(([code, value], index) =>
        code === 2 && parsed[index - 1]?.[0] === 0 && parsed[index - 1]?.[1] === "SECTION"
          ? value
          : null,
      )
      .filter((value): value is string => value !== null);
    expect(sections).toEqual(["HEADER", "TABLES", "ENTITIES"]);
    expect(parsed.at(-1)).toEqual([0, "EOF"]);
  });

  it("объявляет R12 и все пять слоёв", () => {
    const parsed = pairs(dxfFor(makeSimpleRoom()));
    const acadVersionAt = parsed.findIndex(([code, value]) => code === 9 && value === "$ACADVER");
    expect(parsed[acadVersionAt + 1]).toEqual([1, "AC1009"]);
    const layers = parsed
      .filter(([code], index) => code === 2 && parsed[index - 1]?.[1] === "LAYER" && parsed[index - 1]?.[0] === 0)
      .map(([, value]) => value);
    expect(layers).toEqual(["WALLS", "OPENINGS", "COLUMNS", "OBJECTS", "LABELS"]);
  });

  it("несёт провенанс версии в 999-комментариях и не содержит приватных путей", () => {
    const dxf = dxfFor(makeSimpleRoom());
    expect(dxf).toContain("version: V1");
    expect(dxf).toContain(`signature: ${CONTEXT.semanticHash}`);
    expect(dxf).toContain("units: millimetres");
    expect(dxf).not.toMatch(/[A-Za-z]:\\|file:\/\/|https?:\/\//);
  });

  it("детерминирован: один документ — байт в байт один файл", () => {
    const document = makeSimpleRoom();
    expect(dxfFor(document)).toBe(dxfFor(document));
  });
});

describe("DXF R12: геометрия", () => {
  it("каждая стена — четыре LINE на слое WALLS, EXTMIN/EXTMAX — из границ", () => {
    const document = makeSimpleRoom();
    const derived = deriveLayout(document);
    const parsed = pairs(dxfFor(document));

    const wallLines = parsed.filter(
      ([code, value], index) =>
        code === 8 && value === "WALLS" && parsed[index - 1]?.[1] === "LINE",
    );
    expect(wallLines).toHaveLength(document.walls.length * 4);

    const extmin = parsed.findIndex(([code, value]) => code === 9 && value === "$EXTMIN");
    expect(parsed[extmin + 1]).toEqual([10, String(derived.bounds!.minXMm)]);
    expect(parsed[extmin + 2]).toEqual([20, String(derived.bounds!.minYMm)]);
  });

  it("KORA: проёмы дают по три LINE (две щеки и осевая), объекты подписаны ASCII", () => {
    const document = koraFixture as unknown as LayoutDocument;
    const parsed = pairs(dxfFor(document));

    const openingLines = parsed.filter(
      ([code, value], index) =>
        code === 8 && value === "OPENINGS" && parsed[index - 1]?.[1] === "LINE",
    );
    expect(openingLines).toHaveLength(document.openings.length * 3);

    const labels = parsed.filter(
      ([code, value], index) =>
        code === 8 && value === "LABELS" && parsed[index - 1]?.[1] === "TEXT",
    );
    expect(labels.length).toBeGreaterThan(0);
    // Тексты — только ASCII: кириллица в R12 зависит от кодовой страницы.
    for (const [index, [code, value]] of parsed.entries()) {
      if (code === 1 && parsed[index - 2]?.[1] === "LABELS") {
        expect(value).toMatch(/^[\x20-\x7e]+$/);
      }
    }
  });
});

describe("транслитерация подписей", () => {
  it("переводит кириллицу с сохранением капитализации", () => {
    expect(asciiLabel("Диван")).toBe("Divan");
    expect(asciiLabel("Стол обеденный")).toBe("Stol obedennyy");
    expect(asciiLabel("Model X-1")).toBe("Model X-1");
  });
});

describe("экспорт через LayoutExportService", () => {
  it("формат dxf проходит весь контур: подпись, манифест, privacy-гейт", async () => {
    const repository = new MemoryLayoutRepository();
    const document = makeSimpleRoom();
    await repository.publishVersion(document, {
      versionId: "V1",
      authorType: "designer",
      reasonCode: "TEST",
      reason: "Публикация для экспорта",
      createdAt: "2026-08-08T12:00:00.000Z",
      warnings: [],
    });

    const service = new LayoutExportService({
      repository,
      generatorVersion: "test/0.1",
      now: () => "2026-08-08T12:00:00.000Z",
    });
    const exported = await service.exportVersion("V1", "dxf");

    expect(exported.manifest.format).toBe("dxf");
    expect(exported.manifest.filename).toMatch(/^layout-[0-9a-f]{16}-dxf\.dxf$/);
    expect(exported.manifest.mimeType).toBe("image/vnd.dxf");
    expect(exported.artifact).toContain("AC1009");
    expect(exported.artifact).toContain("version: V1");
  });
});
