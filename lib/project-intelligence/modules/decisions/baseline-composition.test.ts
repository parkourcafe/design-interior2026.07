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
      createdAt: "2026-08-01T10:00:00.000Z",
      items: [
        { targetKind: "decision_revision", entityId: "decision-a", revisionId: "decision-r1" },
        { targetKind: "selection_revision", entityId: "selection-a", revisionId: "selection-r1" },
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
          createdAt: "2026-08-02T10:00:00.000Z",
          items: [{
            targetKind: "requirement_revision",
            entityId: "requirement-a",
            revisionId: "requirement-r1",
          }],
        },
        {
          id: "approval-1",
          status: "approved",
          createdAt: "2026-08-01T10:00:00.000Z",
          items: [
            { targetKind: "decision_revision", entityId: "decision-a", revisionId: "decision-r1" },
            { targetKind: "assumption_revision", entityId: "assumption-a", revisionId: "assumption-r1" },
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
          createdAt: "2026-08-03T10:00:00.000Z",
          items: [{
            targetKind: "decision_revision",
            entityId: "decision-a",
            revisionId: "decision-draft",
          }],
        },
        {
          id: "approval-submitted",
          status: "submitted",
          createdAt: "2026-08-03T10:00:00.000Z",
          items: [{
            targetKind: "decision_revision",
            entityId: "decision-a",
            revisionId: "decision-submitted",
          }],
        },
        {
          id: "approval-rejected",
          status: "rejected",
          createdAt: "2026-08-03T10:00:00.000Z",
          items: [{
            targetKind: "decision_revision",
            entityId: "decision-a",
            revisionId: "decision-rejected",
          }],
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
        createdAt: "2026-08-01T10:00:00.000Z",
        items: [
          { targetKind: "decision_revision", entityId: "decision-a", revisionId: "decision-r1" },
          { targetKind: "constraint_revision", entityId: "constraint-a", revisionId: "constraint-r1" },
        ],
      }],
    }))).toThrow(BaselineCompositionError);

    expect(() => composeBaseline(input({
      approvalPackages: [{
        id: "approval-1",
        status: "approved",
        createdAt: "2026-08-01T10:00:00.000Z",
        items: [{
          targetKind: "constraint_revision",
          entityId: "constraint-a",
          revisionId: "constraint-r1",
        }],
      }],
    }))).toThrow(/unknown targetKind "constraint_revision"/);
  });

  it("refuses when there is nothing approved to freeze", () => {
    expect(() => composeBaseline(input({ approvalPackages: [] })))
      .toThrow(/no approved approval package/);
    expect(() => composeBaseline(input({
      approvalPackages: [{
        id: "approval-1",
        status: "submitted",
        createdAt: "2026-08-01T10:00:00.000Z",
        items: [],
      }],
    }))).toThrow(/no approved approval package/);
  });

  it("refuses an approved package that carries no revisions at all", () => {
    // Пустой baseline формально прошёл бы, но заморозил бы ничто — и при этом
    // сдвинул версию, создав видимость выпущенного состояния.
    expect(() => composeBaseline(input({
      approvalPackages: [{
        id: "approval-1",
        status: "approved",
        createdAt: "2026-08-01T10:00:00.000Z",
        items: [],
      }],
    }))).toThrow(/carry no revisions/);
  });

  it("refuses an empty revision id rather than hashing it", () => {
    expect(() => composeBaseline(input({
      approvalPackages: [{
        id: "approval-1",
        status: "approved",
        createdAt: "2026-08-01T10:00:00.000Z",
        items: [{ targetKind: "decision_revision", entityId: "decision-a", revisionId: "" }],
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
          createdAt: "2026-08-02T10:00:00.000Z",
          items: [
            { targetKind: "decision_revision", entityId: "decision-b", revisionId: "decision-r2" },
            { targetKind: "decision_revision", entityId: "decision-a", revisionId: "decision-r1" },
          ],
        },
        {
          id: "approval-1",
          status: "approved",
          createdAt: "2026-08-01T10:00:00.000Z",
          // Та же ревизия той же сущности в двух пакетах — дубль, а не два
          // элемента: побеждает поздний пакет, значение то же.
          items: [{ targetKind: "decision_revision", entityId: "decision-a", revisionId: "decision-r1" }],
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

  /**
   * Правка 11.08, найденная гейтом 2 на живом стеке.
   *
   * Решение пересмотрели и одобрили заново. До правки в состав попадали ОБЕ
   * ревизии одного узла, и база отвергала дескриптор:
   * `BASELINE_REVISION_NOT_IN_GRAPH_VERSION` — старая ревизия в новую версию
   * графа не входит. То есть второй baseline не публиковался вовсе, а без него
   * невозможна заявка на изменение (`NO_CHANGE_ROOTS`).
   */
  it("freezes one revision per entity — the latest approved one", () => {
    const composition = composeBaseline(input({
      approvalPackages: [
        {
          id: "approval-1",
          status: "approved",
          createdAt: "2026-08-01T10:00:00.000Z",
          items: [
            { targetKind: "decision_revision", entityId: "decision-a", revisionId: "decision-r1" },
            { targetKind: "selection_revision", entityId: "selection-a", revisionId: "selection-r1" },
          ],
        },
        {
          id: "approval-2",
          status: "approved",
          createdAt: "2026-08-02T10:00:00.000Z",
          items: [{
            targetKind: "decision_revision",
            entityId: "decision-a",
            revisionId: "decision-r2",
          }],
        },
      ],
    }));

    expect(composition.decisionRevisionIds).toEqual(["decision-r2"]);
    // Сущность, которую заново не одобряли, остаётся в составе как была:
    // «одна ревизия на сущность» — не «только последний пакет».
    expect(composition.selectionRevisionIds).toEqual(["selection-r1"]);
    // Оба пакета остаются основанием заморозки: RPC требует от каждого только
    // статуса `approved` и принадлежности пакету проекта.
    expect(composition.approvalPackageIds).toEqual(["approval-1", "approval-2"]);
  });

  it("decides the winner by approval time, not by input order", () => {
    const late = {
      id: "approval-late",
      status: "approved",
      createdAt: "2026-08-09T10:00:00.000Z",
      items: [{
        targetKind: "decision_revision",
        entityId: "decision-a",
        revisionId: "decision-r9",
      }],
    } as const;
    const early = {
      id: "approval-early",
      status: "approved",
      createdAt: "2026-08-01T10:00:00.000Z",
      items: [{
        targetKind: "decision_revision",
        entityId: "decision-a",
        revisionId: "decision-r1",
      }],
    } as const;

    for (const order of [[late, early], [early, late]]) {
      expect(composeBaseline(input({ approvalPackages: order })).decisionRevisionIds)
        .toEqual(["decision-r9"]);
    }
  });

  it("refuses an approval item without an entity id rather than freezing twice", () => {
    // Без идентификатора сущности «одна ревизия на сущность» неисполнимо, и
    // тихое возвращение к прежнему поведению вернуло бы ровно тот дефект,
    // который правка закрывает.
    expect(() => composeBaseline(input({
      approvalPackages: [{
        id: "approval-1",
        status: "approved",
        createdAt: "2026-08-01T10:00:00.000Z",
        items: [{ targetKind: "decision_revision", entityId: "", revisionId: "decision-r1" }],
      }],
    }))).toThrow(/empty entityId/);
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
