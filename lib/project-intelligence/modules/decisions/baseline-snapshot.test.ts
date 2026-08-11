import { describe, expect, it } from "vitest";

import type { BaselineCompositionInput } from "./baseline-composition";
import {
  buildBaselineSnapshot,
  confirmBaselineSnapshot,
} from "./baseline-snapshot";

const PACKAGE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PACKAGE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function input(overrides: Partial<BaselineCompositionInput> = {}): BaselineCompositionInput {
  return {
    approvalPackages: [{
      id: "approval-1",
      status: "approved",
      items: [
        { targetKind: "decision_revision", revisionId: "decision-r1" },
        { targetKind: "selection_revision", revisionId: "selection-r1" },
      ],
    }],
    packageIds: [PACKAGE_A],
    previousBaselineId: null,
    ...overrides,
  };
}

describe("baseline snapshot — preview and confirm cannot disagree", () => {
  const base = buildBaselineSnapshot(input()).token;

  it("confirms when nothing changed between preview and confirm", () => {
    expect(confirmBaselineSnapshot(input(), base))
      .toEqual({ ok: true, composition: buildBaselineSnapshot(input()).composition });
  });

  it("is stable across input order, so a harmless reshuffle is not a false conflict", () => {
    // Чтение не обещает порядок approval packages. Токен, зависящий от него,
    // ронял бы публикацию на ровном месте.
    const reordered = buildBaselineSnapshot(input({
      approvalPackages: [{
        id: "approval-1",
        status: "approved",
        items: [
          { targetKind: "selection_revision", revisionId: "selection-r1" },
          { targetKind: "decision_revision", revisionId: "decision-r1" },
        ],
      }],
    })).token;
    expect(reordered).toBe(base);
  });

  /**
   * Ровно то, ради чего токен существует. `expectedGraphVersionId` из варианта
   * A ни одного из этих случаев не заметил бы: версия графа не меняется, когда
   * меняются одобрения, пакеты или решения.
   */
  const races: ReadonlyArray<readonly [string, Partial<BaselineCompositionInput>]> = [
    ["одобрили ещё один пакет", {
      approvalPackages: [
        input().approvalPackages[0]!,
        {
          id: "approval-2",
          status: "approved",
          items: [{ targetKind: "decision_revision", revisionId: "decision-r2" }],
        },
      ],
    }],
    ["в одобренный пакет добавилась ревизия", {
      approvalPackages: [{
        id: "approval-1",
        status: "approved",
        items: [
          { targetKind: "decision_revision", revisionId: "decision-r1" },
          { targetKind: "selection_revision", revisionId: "selection-r1" },
          { targetKind: "requirement_revision", revisionId: "requirement-r1" },
        ],
      }],
    }],
    ["появился новый пакет проекта", { packageIds: [PACKAGE_A, PACKAGE_B] }],
    ["кто-то успел выпустить baseline раньше", { previousBaselineId: "baseline-v1" }],
    ["воркер добавил ревизию источника", { sourceRevisionIds: ["source-a"] }],
  ];

  for (const [label, override] of races) {
    it(`refuses with state_stale when ${label}`, () => {
      expect(confirmBaselineSnapshot(input(override), base))
        .toEqual({ ok: false, reason: "state_stale" });
    });
  }

  it("refuses a token from a different project state without throwing", () => {
    // Отказ — значение, а не исключение: это нормальный исход гонки, который
    // поверхность обязана показать, а не авария.
    expect(confirmBaselineSnapshot(input(), "sha256:" + "0".repeat(64)))
      .toEqual({ ok: false, reason: "state_stale" });
  });

  it("still refuses to compose an incomplete baseline at confirm time", () => {
    // Правило полноты не ослабевает оттого, что состав уже показывали: если к
    // моменту подтверждения появился неизвестный вид ревизии, публиковать
    // нельзя вовсе, а не «как показывали».
    expect(() => confirmBaselineSnapshot(input({
      approvalPackages: [{
        id: "approval-1",
        status: "approved",
        items: [{ targetKind: "constraint_revision", revisionId: "constraint-r1" }],
      }],
    }), base)).toThrow(/unknown targetKind/);
  });
});
