import { describe, expect, it } from "vitest";
import {
  DecisionContractError,
  attachPriceObservation,
  attachSelectionEvidence,
  createApprovalPackage,
  createSelectionCandidate,
  reviewApprovalPackage,
  reviseSelectionCandidate,
  submitApprovalPackage,
  supersedeSelection,
  validateRevisionEntity,
} from "@/lib/project-intelligence/modules/decisions";

const actor = { actorId: "member-architect", actorType: "human" } as const;
const systemActor = { actorId: "source-extraction-worker", actorType: "system" } as const;
const evidence = {
  evidenceId: "evidence-001",
  sourceId: "source-001",
  sourceRevisionId: "source-revision-001",
  fragmentId: "fragment-001",
} as const;

function identity(
  revisionNo: number,
  reason: string,
  createdBy: typeof actor | typeof systemActor = actor,
) {
  return {
    revisionId: `selection-revision-${revisionNo}`,
    revisionNo,
    createdAt: `2026-07-17T0${revisionNo}:00:00Z`,
    createdBy,
    reason,
  };
}

describe("M2 decision and selection contracts", () => {
  it("validates Requirement, Assumption and Decision revisions through one immutable contract", () => {
    const requirement = validateRevisionEntity({
      id: "requirement-r1",
      projectId: "project-kora",
      entityId: "requirement-egress",
      revisionNo: 1,
      kind: "requirement",
      statement: "Сохранить нормативный путь эвакуации.",
      areaId: null,
      packageId: "package-architecture",
      claimStatus: "human_origin",
      reviewStatus: "draft",
      evidence: [],
      createdAt: "2026-07-17T01:00:00Z",
      createdBy: actor,
      reason: "Требование создано архитектором.",
      replacesRevisionId: null,
    });
    const assumption = validateRevisionEntity({
      id: "assumption-r1",
      projectId: "project-kora",
      entityId: "assumption-site-access",
      revisionNo: 1,
      kind: "assumption",
      statement: "Доставка возможна в утреннее окно.",
      areaId: null,
      packageId: "package-controls",
      validationNeeded: "Подтвердить у управляющего площадкой.",
      claimStatus: "interpreted",
      reviewStatus: "submitted",
      evidence: [evidence],
      createdAt: "2026-07-17T01:00:00Z",
      createdBy: systemActor,
      reason: "Интерпретировано из протокола.",
      replacesRevisionId: null,
    });
    const decision = validateRevisionEntity({
      id: "decision-r2",
      projectId: "project-kora",
      entityId: "decision-floor-finish",
      revisionNo: 2,
      kind: "decision",
      title: "Покрытие пола",
      resolution: "Матовый керамогранит.",
      areaId: "area-first-floor",
      packageId: "package-architecture",
      status: "proposed",
      claimStatus: "human_origin",
      reviewStatus: "draft",
      evidence: [],
      createdAt: "2026-07-17T02:00:00Z",
      createdBy: actor,
      reason: "Материал изменён по запросу заказчика.",
      replacesRevisionId: "decision-r1",
    });

    expect([requirement.kind, assumption.kind, decision.kind]).toEqual([
      "requirement",
      "assumption",
      "decision",
    ]);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(assumption.createdBy.actorType).toBe("system");
    expect(() => validateRevisionEntity({
      ...assumption,
      id: "assumption-invalid",
      evidence: [],
    })).toThrowError(/exact source evidence/);
    expect(() => validateRevisionEntity({
      ...requirement,
      id: "requirement-invalid-system-origin",
      createdBy: systemActor,
    })).toThrowError(/human-origin revision/);
  });

  it("keeps every selection operation as a new immutable exact revision", () => {
    const first = createSelectionCandidate({
      projectId: "project-kora",
      entityId: "selection-floor-finish",
      title: "Напольное покрытие первого этажа",
      areaId: "area-first-floor",
      packageId: "package-first-floor",
      decisionRevisionId: "decision-floor-finish-r1",
      specification: { material: "porcelain", finish: "matte" },
      claimStatus: "interpreted",
      evidence: [evidence],
      identity: identity(1, "Извлечено из утверждаемого листа отделки."),
    });
    const withEvidence = attachSelectionEvidence(first, identity(2, "Добавлен точный фрагмент ведомости."), {
      evidenceId: "evidence-002",
      sourceId: "source-002",
      sourceRevisionId: "source-revision-002",
    });
    const withPrice = attachPriceObservation(withEvidence, identity(3, "Зафиксирована проверенная цена."), {
      id: "price-001",
      projectId: "project-kora",
      amountRub: 145_000,
      observedAt: "2026-07-17T03:00:00Z",
      evidence,
      supplierRef: "supplier-redacted-001",
    });

    expect(first).not.toBe(withEvidence);
    expect(first.evidence).toHaveLength(1);
    expect(withEvidence.evidence).toHaveLength(2);
    expect(withPrice.priceObservations[0]).toMatchObject({
      amountRub: 145_000,
      selectionRevisionId: "selection-revision-3",
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(withPrice.priceObservations)).toBe(true);
  });

  it("requires source evidence for non-human revisions and safe integer RUB", () => {
    expect(() => createSelectionCandidate({
      projectId: "project-kora",
      entityId: "selection-1",
      title: "Selection",
      areaId: "area-1",
      packageId: "package-1",
      decisionRevisionId: "decision-r1",
      specification: { material: "stone" },
      claimStatus: "extracted",
      identity: identity(1, "Imported.", systemActor),
    })).toThrowError(DecisionContractError);

    const selection = createSelectionCandidate({
      projectId: "project-kora",
      entityId: "selection-1",
      title: "Selection",
      areaId: "area-1",
      packageId: "package-1",
      decisionRevisionId: "decision-r1",
      specification: { material: "stone" },
      claimStatus: "extracted",
      evidence: [evidence],
      identity: identity(1, "Imported.", systemActor),
    });
    expect(() => attachPriceObservation(selection, identity(2, "Fraction rejected."), {
      id: "price-fraction",
      projectId: "project-kora",
      amountRub: 12.5,
      observedAt: "2026-07-17T03:00:00Z",
      evidence,
      supplierRef: null,
    })).toThrowError(/safe integer roubles/);
  });

  it("revises selection title, specification and decision binding as one new exact revision", () => {
    const first = createSelectionCandidate({
      projectId: "project-kora",
      entityId: "selection-floor-finish",
      title: "Первоначальное покрытие",
      areaId: "area-first-floor",
      packageId: "package-first-floor",
      decisionRevisionId: "decision-floor-r1",
      specification: { material: "stone", finish: "polished" },
      claimStatus: "human_origin",
      identity: identity(1, "Создан первый кандидат."),
    });
    const revised = reviseSelectionCandidate({
      previous: first,
      identity: identity(2, "Заказчик выбрал новое покрытие."),
      title: "Подтверждаемое покрытие",
      decisionRevisionId: "decision-floor-r2",
      specification: { material: "porcelain", finish: "matte" },
      evidence: [evidence],
    });

    expect(revised).toMatchObject({
      id: "selection-revision-2",
      revisionNo: 2,
      title: "Подтверждаемое покрытие",
      decisionRevisionId: "decision-floor-r2",
      specification: { material: "porcelain", finish: "matte" },
      reviewStatus: "draft",
      replacesRevisionId: first.id,
    });
    expect(first.title).toBe("Первоначальное покрытие");
    expect(() => reviseSelectionCandidate({
      previous: first,
      identity: identity(2, "Пустое изменение."),
    })).toThrowError(/change at least one controlled field/);
    expect(() => reviseSelectionCandidate({
      previous: first,
      identity: identity(2, "Семантически то же значение."),
      specification: { material: "stone", finish: "polished" },
    })).toThrowError(/change at least one controlled field/);
  });

  it("approves the exact submitted revision and never auto-approves it", () => {
    const selection = createSelectionCandidate({
      projectId: "project-kora",
      entityId: "selection-1",
      title: "Selection",
      areaId: "area-1",
      packageId: "package-1",
      decisionRevisionId: "decision-r1",
      specification: { material: "stone" },
      claimStatus: "human_origin",
      identity: identity(1, "Создано архитектором."),
    });
    const draft = createApprovalPackage({
      id: "approval-package-1",
      projectId: "project-kora",
      packageId: "package-1",
      revisions: [selection],
    });
    const submitted = submitApprovalPackage(draft, actor, "2026-07-17T04:00:00Z");
    const approved = reviewApprovalPackage(submitted, {
      decision: "approved",
      actor,
      reviewedAt: "2026-07-17T05:00:00Z",
      reason: "Материал и цена подтверждены человеком.",
    });

    expect(draft.status).toBe("draft");
    expect(submitted.status).toBe("submitted");
    expect(approved.status).toBe("approved");
    expect(approved.items).toEqual([{
      targetKind: "selection_revision",
      entityId: "selection-1",
      revisionId: "selection-revision-1",
    }]);
    expect(() => reviewApprovalPackage(submitted, {
      decision: "approved",
      actor: systemActor as unknown as typeof actor,
      reviewedAt: "2026-07-17T05:00:00Z",
      reason: "System must not approve.",
    })).toThrowError(/human actor/);
  });

  it("supersedes only the exact previous revision", () => {
    const first = createSelectionCandidate({
      projectId: "project-kora",
      entityId: "selection-1",
      title: "Selection",
      areaId: "area-1",
      packageId: "package-1",
      decisionRevisionId: "decision-r1",
      specification: { material: "stone" },
      claimStatus: "human_origin",
      identity: identity(1, "Created."),
    });
    const second = attachSelectionEvidence(first, identity(2, "Evidence attached."), evidence);
    const result = supersedeSelection(first, second);
    expect(result.superseded.reviewStatus).toBe("superseded");
    expect(result.replacement.replacesRevisionId).toBe(first.id);
  });
});
