import { describe, expect, it } from "vitest";

import {
  BaselineCompositionError,
  composeBaseline,
  type BaselineCompositionInput,
} from "./baseline-composition";

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

describe("baseline composition — the completeness rule", () => {
  it("takes every revision of every approved package", () => {
    const composition = composeBaseline(input({
      approvalPackages: [
        {
          id: "approval-2",
          status: "approved",
          items: [{ targetKind: "requirement_revision", revisionId: "requirement-r1" }],
        },
        {
          id: "approval-1",
          status: "approved",
          items: [
            { targetKind: "decision_revision", revisionId: "decision-r1" },
            { targetKind: "assumption_revision", revisionId: "assumption-r1" },
          ],
        },
      ],
    }));

    expect(composition.approvalPackageIds).toEqual(["approval-1", "approval-2"]);
    expect(composition.requirementRevisionIds).toEqual(["requirement-r1"]);
    expect(composition.assumptionRevisionIds).toEqual(["assumption-r1"]);
    expect(composition.decisionRevisionIds).toEqual(["decision-r1"]);
  });

  it("ignores packages that are not approved", () => {
    // RPC отвергнет неодобренную ревизию как BASELINE_REVISION_NOT_APPROVED —
    // сборщик обязан не доводить до этого отказа.
    const composition = composeBaseline(input({
      approvalPackages: [
        input().approvalPackages[0]!,
        {
          id: "approval-draft",
          status: "draft",
          items: [{ targetKind: "decision_revision", revisionId: "decision-draft" }],
        },
        {
          id: "approval-submitted",
          status: "submitted",
          items: [{ targetKind: "decision_revision", revisionId: "decision-submitted" }],
        },
        {
          id: "approval-rejected",
          status: "rejected",
          items: [{ targetKind: "decision_revision", revisionId: "decision-rejected" }],
        },
      ],
    }));

    expect(composition.approvalPackageIds).toEqual(["approval-1"]);
    expect(composition.decisionRevisionIds).toEqual(["decision-r1"]);
  });

  /**
   * Сердце правила и прямой ответ на риск из проверки №2.
   *
   * База проверяет ревизии только в одну сторону и неполный baseline примет
   * молча. Значит вид, которого сборщик не знает, обязан ронять сборку, а не
   * теряться: тихая потеря — это и есть неполная заморозка.
   */
  it("refuses an unknown targetKind instead of dropping it", () => {
    expect(() => composeBaseline(input({
      approvalPackages: [{
        id: "approval-1",
        status: "approved",
        items: [
          { targetKind: "decision_revision", revisionId: "decision-r1" },
          { targetKind: "constraint_revision", revisionId: "constraint-r1" },
        ],
      }],
    }))).toThrow(BaselineCompositionError);

    expect(() => composeBaseline(input({
      approvalPackages: [{
        id: "approval-1",
        status: "approved",
        items: [{ targetKind: "constraint_revision", revisionId: "constraint-r1" }],
      }],
    }))).toThrow(/unknown targetKind "constraint_revision"/);
  });

  it("refuses when there is nothing approved to freeze", () => {
    expect(() => composeBaseline(input({ approvalPackages: [] })))
      .toThrow(/no approved approval package/);
    expect(() => composeBaseline(input({
      approvalPackages: [{ id: "approval-1", status: "submitted", items: [] }],
    }))).toThrow(/no approved approval package/);
  });

  it("refuses an approved package that carries no revisions at all", () => {
    // Пустой baseline формально прошёл бы, но заморозил бы ничто — и при этом
    // сдвинул версию, создав видимость выпущенного состояния.
    expect(() => composeBaseline(input({
      approvalPackages: [{ id: "approval-1", status: "approved", items: [] }],
    }))).toThrow(/carry no revisions/);
  });

  it("refuses an empty revision id rather than hashing it", () => {
    expect(() => composeBaseline(input({
      approvalPackages: [{
        id: "approval-1",
        status: "approved",
        items: [{ targetKind: "decision_revision", revisionId: "" }],
      }],
    }))).toThrow(/empty revisionId/);
  });

  it("deduplicates and orders by code point, matching the hash side", () => {
    // Порядок обязан совпасть с тем, в котором считается semantic hash, иначе
    // отправленный дескриптор упрётся в BASELINE_SEMANTIC_HASH_MISMATCH.
    const composition = composeBaseline(input({
      approvalPackages: [
        {
          id: "approval-2",
          status: "approved",
          items: [
            { targetKind: "decision_revision", revisionId: "decision-r2" },
            { targetKind: "decision_revision", revisionId: "decision-r1" },
          ],
        },
        {
          id: "approval-1",
          status: "approved",
          // Та же ревизия в двух пакетах — дубль, а не два элемента.
          items: [{ targetKind: "decision_revision", revisionId: "decision-r1" }],
        },
      ],
      packageIds: [PACKAGE_B, PACKAGE_A, PACKAGE_B],
    }));

    expect(composition.decisionRevisionIds).toEqual(["decision-r1", "decision-r2"]);
    expect(composition.packageIds).toEqual([PACKAGE_A, PACKAGE_B]);
  });

  it("keeps sources out of the approval path and empty by default", () => {
    // Источники не проходят через approval packages: RPC их с одобрением не
    // сверяет. У браузерного проекта их нет вовсе — узлы графа создаёт
    // воркерный ingest.
    expect(composeBaseline(input()).sourceRevisionIds).toEqual([]);
    expect(composeBaseline(input({ sourceRevisionIds: ["source-b", "source-a"] }))
      .sourceRevisionIds).toEqual(["source-a", "source-b"]);
  });

  it("freezes the full approved state, not the delta since the last baseline", () => {
    // A′: «полная заморозка актуального утверждённого состояния». Ревизия,
    // вошедшая в прошлый baseline, входит и в следующий — вычитать нечего, и
    // поэтому знать состав прошлого baseline сборщику не нужно.
    const composition = composeBaseline(input({ previousBaselineId: "baseline-v1" }));
    expect(composition.previousBaselineId).toBe("baseline-v1");
    expect(composition.decisionRevisionIds).toEqual(["decision-r1"]);
  });
});
