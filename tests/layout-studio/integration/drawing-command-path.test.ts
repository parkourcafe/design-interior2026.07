import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SHELL = "components/layout-studio/layout-studio-shell.tsx";
const source = readFileSync(join(process.cwd(), SHELL), "utf8");

/**
 * Рисование и удаление обязаны идти тем же путём, что и любая другая правка:
 * через session.dispatch и канонические команды. Прямая мутация документа
 * дала бы визуально тот же результат, но мимо валидации, мимо ревизии и мимо
 * undo — и разошлась бы с тем, что уедет в опубликованную версию.
 *
 * Проверка статическая: поднимать браузер ради этого дороже, чем прочитать
 * исходник, а сама геометрия привязок покрыта отдельно (wall-drawing.test.ts).
 */
describe("Рисование идёт через канонические команды", () => {
  it("добавляет узлы и стены только командами", () => {
    expect(source).toMatch(/type:\s*"ADD_NODE"/);
    expect(source).toMatch(/type:\s*"ADD_WALL"/);
    expect(source).toMatch(/type:\s*"DELETE_ENTITY"/);
  });

  it("не правит массивы документа в обход движка", () => {
    for (const collection of ["nodes", "walls", "openings", "columns", "objects"]) {
      expect(source, `прямая мутация document.${collection}`).not.toMatch(
        new RegExp(`document\\.${collection}\\.(push|splice|pop|shift|unshift)\\b`),
      );
    }
  });

  it("берёт актуальный документ из сессии перед каждой командой цепочки", () => {
    // Каждая команда поднимает ревизию, поэтому вторая команда, собранная на
    // снимке до первой, была бы отклонена как устаревшая.
    expect(source).toMatch(/session\.getState\(\)\.document/);
  });

  it("удаление спрашивает подтверждение вместо тихого каскада", () => {
    expect(source).toMatch(/ENTITY_HAS_DEPENDENTS/);
    expect(source).toMatch(/confirmCascade/);
  });

  it("инструмент рисования доступен только на плане 2D", () => {
    expect(source).toMatch(/disabled=\{viewMode !== "2d"\}/);
  });

  it("пересчитывает клик в миллиметры матрицей SVG, а не своей арифметикой", () => {
    // Ручной пересчёт разъехался бы с зумом и панорамой при первом же
    // изменении их формул.
    expect(source).toMatch(/getScreenCTM\(\)/);
    expect(source).toMatch(/matrixTransform/);
  });
});
