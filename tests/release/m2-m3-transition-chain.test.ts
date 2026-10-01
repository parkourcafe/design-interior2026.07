import { describe, expect, it } from "vitest";
import {
  createRoomDesignIntent,
  type RoomDesignIntent,
} from "@/lib/project-intelligence/modules/design-intent";
import {
  createDesignIntentBudget,
  type DesignIntentBudget,
} from "@/lib/project-intelligence/modules/design-intent/budget";
import {
  createApprovedM2Commit,
  createM2ApprovalSubmission,
  reviewM2ApprovalSubmission,
  type ApprovedM2Commit,
  type M2ApprovalDecision,
} from "@/lib/project-intelligence/application/m2-approval";
import {
  createM2ToM3Handoff,
  M2ToM3HandoffError,
  type CreateM2ToM3HandoffInput,
  type M2ToM3Handoff,
} from "@/lib/project-intelligence/application/m2-to-m3-handoff";
import {
  registerDocumentationSheet,
  reviewPackageCompleteness,
} from "@/lib/project-intelligence/modules/documentation";
import {
  DecisionContractError,
  type HumanActorRef,
  type SelectionRevision,
} from "@/lib/project-intelligence/modules/decisions";

// T-REMH-01 R2: один непрерывный прогон перехода M2 → M3 на синтетических
// данных. Существующие тесты проверяют каждое звено отдельно, каждое на своей
// фикстуре (spb-studio-40m-product-run — до коммита M2, m2-to-m3-handoff и
// documentation/handoff-shape — от готового коммита). Здесь выход одного звена
// становится входом следующего, и проверяется, что идентификаторы, подпись
// планировки, набор выборов и сумма доходят до листа документации без подмены.
//
// Данные синтетические: комната, позиции и цены назначены в тесте, это не
// реальный проект и не доказательство цикла 7.
//
// В продукте звено «коммит M2 → вход handoff» выполняет SQL
// (`publish_m2_m3_handoff`, 20260802090000): TS-тип ApprovedM2Commit не несёт
// id/revisionId/status коммита, id пакета согласования и revisionId
// планировки — их присваивает хранилище. Функция `persisted` ниже — тестовая
// замена этой записи, а не продуктовый адаптер.

const PROJECT = "7e2a0000-0000-4000-8000-000000000001";
const PACKAGE = "7e2a0000-0000-4000-8000-000000000002";
const ROOM = "room-synthetic-kitchen";
const AT = "2026-09-28T09:00:00.000Z";

const designer: HumanActorRef = { actorId: "actor-synthetic-designer", actorType: "human" };
const client: HumanActorRef = { actorId: "actor-synthetic-client", actorType: "human" };

const VARIANTS = [
  { slug: "preferred", role: "preferred", prices: [180_000, 42_000] },
  { slug: "value", role: "value_engineered", prices: [95_000, 18_000] },
  { slug: "premium", role: "premium", prices: [410_000, 97_000] },
] as const;

const hashFor = (slug: string) => `sha256:${Buffer.from(slug).toString("hex").padEnd(64, "0")}`;
const layoutRevisionFor = (index: number) => `7e2a0000-0000-4000-8000-00000000010${index}`;
const selectionId = (slug: string, index: number, revisionNo = 1) =>
  `selection-${slug}-${index}@${revisionNo}`;

function selection(
  slug: string,
  index: number,
  amountRub: number,
  revisionNo = 1,
): SelectionRevision {
  const id = selectionId(slug, index, revisionNo);
  const evidence = {
    evidenceId: `evidence-${slug}-${index}`,
    sourceId: "source-synthetic-estimate",
    sourceRevisionId: "source-synthetic-estimate@1",
    fragmentId: `row=${index}`,
  };
  return {
    id,
    projectId: PROJECT,
    entityId: `entity-${slug}-${index}`,
    revisionNo,
    kind: "selection",
    title: `Синтетическая позиция ${slug} #${index}`,
    areaId: ROOM,
    packageId: PACKAGE,
    decisionRevisionId: `decision-${slug}@1`,
    specification: { unit: "шт", quantity: "1" },
    claimStatus: "extracted",
    reviewStatus: "approved",
    evidence: [evidence],
    priceObservations: [{
      id: `price-${slug}-${index}-r${revisionNo}`,
      projectId: PROJECT,
      selectionRevisionId: id,
      amountRub,
      observedAt: AT,
      evidence,
      supplierRef: "synthetic:estimate",
    }],
    createdAt: AT,
    createdBy: designer,
    reason: "Синтетическая позиция для release-теста",
    replacesRevisionId: null,
  } satisfies SelectionRevision;
}

const selectionsBySlug = new Map(
  VARIANTS.map((variant) => [
    variant.slug,
    variant.prices.map((price, index) => selection(variant.slug, index, price)),
  ]),
);
const allSelections = [...selectionsBySlug.values()].flat();

function buildIntent(): RoomDesignIntent {
  return createRoomDesignIntent({
    designIntentId: "intent-synthetic-kitchen",
    projectId: PROJECT,
    packageId: PACKAGE,
    roomId: ROOM,
    revision: {
      revisionId: "intent-synthetic-kitchen@1",
      revisionNo: 1,
      createdAt: AT,
      createdBy: designer,
      reason: "Три варианта кухни",
    },
    variants: VARIANTS.map((variant) => ({
      variantId: `variant-${variant.slug}`,
      role: variant.role,
      projectId: PROJECT,
      packageId: PACKAGE,
      roomId: ROOM,
      layoutDocumentId: `layout-${variant.slug}`,
      layoutVersionId: `layout-${variant.slug}@1`,
      semanticHash: hashFor(variant.slug),
    })),
  });
}

function buildBudget(
  selections: readonly SelectionRevision[] = allSelections,
  asOf = AT,
): DesignIntentBudget {
  return createDesignIntentBudget({
    intent: buildIntent(),
    selections,
    bindings: VARIANTS.map((variant) => ({
      variantId: `variant-${variant.slug}`,
      selectionRevisionIds: selections
        .filter((candidate) => candidate.decisionRevisionId === `decision-${variant.slug}@1`)
        .map((candidate) => candidate.id),
    })),
    asOf,
    staleAfterDays: 30,
  });
}

const chosen = selectionsBySlug.get("preferred")!;

function review(decision: M2ApprovalDecision) {
  const submission = createM2ApprovalSubmission({
    submissionId: "submission-synthetic-kitchen-1",
    intent: buildIntent(),
    chosenVariantId: "variant-preferred",
    selectionRevisionIds: chosen.map((candidate) => candidate.id),
    selections: chosen,
    budget: buildBudget(),
    submittedBy: designer,
    submittedAt: "2026-09-28T10:00:00.000Z",
    reason: "Рекомендуемый вариант готов к согласованию",
  });
  return reviewM2ApprovalSubmission({
    submission,
    decision,
    reviewedBy: client,
    reviewedAt: "2026-09-28T11:00:00.000Z",
    reason: decision === "approved" ? "Клиент согласовал" : "Клиент просит правки",
  });
}

function approvedCommit(): ApprovedM2Commit {
  return createApprovedM2Commit({
    approvedSubmission: review("approved"),
    currentIntent: buildIntent(),
    currentSelections: chosen,
    recalculatedBudget: buildBudget(),
  });
}

/** Тестовая замена SQL-записи коммита: поля, которые присваивает хранилище. */
function persisted(
  commit: ApprovedM2Commit,
  overrides: { status?: "approved" | "change_requested"; layoutStatus?: string; layoutHash?: string } = {},
): CreateM2ToM3HandoffInput {
  const layoutRevisionId = layoutRevisionFor(0);
  return {
    projectId: PROJECT,
    packageId: PACKAGE,
    approvedCommit: {
      id: "m2-commit-synthetic-kitchen",
      projectId: commit.projectId,
      packageId: commit.packageId,
      revisionId: "7e2a0000-0000-4000-8000-000000000201",
      revisionNo: 1,
      status: overrides.status ?? "approved",
      payload: {
        approvalPackageId: "approval-synthetic-kitchen-1",
        roomId: commit.roomId,
        designIntentRevisionId: commit.designIntentRevisionId,
        chosenVariant: {
          variantId: commit.chosenVariant.variantId,
          role: commit.chosenVariant.role,
          layoutDocumentId: commit.chosenVariant.layoutDocumentId,
          layoutVersionId: commit.chosenVariant.layoutVersionId,
          layoutRevisionId,
          semanticHash: commit.chosenVariant.semanticHash,
        },
        approvedSelectionRevisionIds: commit.approvedSelectionRevisionIds,
        budget: {
          asOf: commit.budget.asOf,
          staleAfterDays: commit.budget.staleAfterDays,
          amountRub: commit.budget.amountRub,
          staleSelectionRevisionIds: commit.budget.staleSelectionRevisionIds,
          missingPriceSelectionRevisionIds: commit.budget.missingPriceSelectionRevisionIds,
        },
        submittedAt: commit.submittedAt,
        reviewedAt: commit.reviewedAt,
        submissionReason: commit.submissionReason,
        reviewReason: commit.reviewReason,
      },
      createdAt: "2026-09-28T11:00:01.000Z",
    },
    layoutVersions: VARIANTS.map((variant, index) => ({
      projectId: PROJECT,
      packageId: PACKAGE,
      documentId: `layout-${variant.slug}`,
      versionId: `layout-${variant.slug}@1`,
      revisionId: layoutRevisionFor(index),
      revisionNo: 1,
      status: variant.slug === "preferred" ? overrides.layoutStatus ?? "published" : "published",
      semanticHash: variant.slug === "preferred" ? overrides.layoutHash ?? hashFor(variant.slug) : hashFor(variant.slug),
      roomId: ROOM,
      variantId: `variant-${variant.slug}`,
      role: variant.role,
    })),
    selections: allSelections.map((candidate) => ({
      projectId: PROJECT,
      packageId: PACKAGE,
      entityId: candidate.entityId,
      revisionId: candidate.id,
      revisionNo: candidate.revisionNo,
      status: candidate.reviewStatus,
    })),
  };
}

function sheetFrom(handoff: M2ToM3Handoff, specificationRevisionIds: readonly string[], sheetId = "sheet-a101") {
  return registerDocumentationSheet({
    sheetId,
    sheetNumber: sheetId === "sheet-a101" ? "A-101" : "A-102",
    title: "План кухни",
    roomId: handoff.roomId,
    revision: {
      revisionId: `${sheetId}@1`,
      revisionNo: 1,
      createdAt: "2026-09-28T12:00:00.000Z",
      createdBy: designer,
      reason: "Лист по утверждённому варианту",
    },
    handoff,
    specificationRevisionIds,
  });
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof DecisionContractError || error instanceof M2ToM3HandoffError) return error.code;
    throw error;
  }
  return undefined;
}

describe("R2 · переход M2 → M3 одним прогоном на синтетических данных", () => {
  it("проводит выбор от согласования клиентом до полного листа документации без подмены данных", () => {
    const commit = approvedCommit();
    const handoff = createM2ToM3Handoff(persisted(commit));
    const sheet = sheetFrom(handoff, handoff.selectionRevisionIds);
    const report = reviewPackageCompleteness({ handoff, sheets: [sheet] });

    const chosenIds = chosen.map((candidate) => candidate.id).sort();
    // Сумма = сумма цен выбранных позиций, целые рубли.
    expect(commit.budget.amountRub).toBe(180_000 + 42_000);
    expect(Number.isSafeInteger(commit.budget.amountRub)).toBe(true);
    // Кто подал и кто согласовал — разные люди, и это сохранено в коммите.
    expect(commit.submittedBy.actorId).toBe(designer.actorId);
    expect(commit.reviewedBy.actorId).toBe(client.actorId);

    // Handoff несёт ровно утверждённое: набор выборов, подпись планировки, ревизию намерения.
    expect([...handoff.selectionRevisionIds]).toEqual(chosenIds);
    expect(handoff.layout.semanticHash).toBe(hashFor("preferred"));
    expect(handoff.designIntentRevisionId).toBe("intent-synthetic-kitchen@1");
    expect(handoff.approvedAt).toBe(commit.reviewedAt);

    // Лист документации помнит, из какого решения он построен.
    expect(sheet.origin).toEqual({
      handoffContractVersion: handoff.contractVersion,
      approvedM2CommitRevisionId: handoff.approvedM2CommitRevisionId,
      designIntentRevisionId: "intent-synthetic-kitchen@1",
      layoutDocumentId: "layout-preferred",
      layoutVersionId: "layout-preferred@1",
      layoutRevisionId: layoutRevisionFor(0),
      semanticHash: hashFor("preferred"),
    });
    expect(report).toEqual({ complete: true, findings: [] });
    expect(Object.isFrozen(handoff) && Object.isFrozen(sheet)).toBe(true);
  });

  it("запрос правок клиентом останавливает переход и в коммите M2, и на входе M3", () => {
    const changeRequested = review("change_requested");
    expect(codeOf(() => createApprovedM2Commit({
      approvedSubmission: changeRequested,
      currentIntent: buildIntent(),
      currentSelections: chosen,
      recalculatedBudget: buildBudget(),
    }))).toBe("M2_COMMIT_NOT_APPROVED");

    // Даже если бы хранилище записало коммит не в статусе approved, дверь M3 закрыта.
    expect(codeOf(() => createM2ToM3Handoff(persisted(approvedCommit(), { status: "change_requested" }))))
      .toBe("M2_M3_COMMIT_NOT_APPROVED");
  });

  it("не коммитит решение, если цена выбранной позиции изменилась после согласования", () => {
    const repriced = allSelections.map((candidate) => (
      candidate.id === selectionId("preferred", 0)
        ? { ...candidate, priceObservations: [{ ...candidate.priceObservations[0]!, amountRub: 195_000 }] }
        : candidate
    ));
    expect(codeOf(() => createApprovedM2Commit({
      approvedSubmission: review("approved"),
      currentIntent: buildIntent(),
      currentSelections: chosen,
      recalculatedBudget: buildBudget(repriced),
    }))).toBe("M2_COMMIT_STALE_BUDGET");
  });

  it("не принимает на согласование вариант с устаревшими ценами", () => {
    expect(codeOf(() => createM2ApprovalSubmission({
      submissionId: "submission-synthetic-kitchen-stale",
      intent: buildIntent(),
      chosenVariantId: "variant-preferred",
      selectionRevisionIds: chosen.map((candidate) => candidate.id),
      selections: chosen,
      budget: buildBudget(allSelections, "2026-12-28T09:00:00.000Z"),
      submittedBy: designer,
      submittedAt: "2026-12-28T10:00:00.000Z",
      reason: "Подача через три месяца после сметы",
    }))).toBe("M2_APPROVAL_MISSING_PRICE");
  });

  it("M3 не строится от неопубликованной или подменённой планировки", () => {
    expect(codeOf(() => createM2ToM3Handoff(persisted(approvedCommit(), { layoutStatus: "draft" }))))
      .toBe("M2_M3_EXACT_LAYOUT_NOT_FOUND");
    expect(codeOf(() => createM2ToM3Handoff(persisted(approvedCommit(), { layoutHash: hashFor("other") }))))
      .toBe("M2_M3_LAYOUT_MISMATCH");
  });

  it("лист M3 не ссылается на неутверждённый выбор и видит неполный или чужой пакет", () => {
    const handoff = createM2ToM3Handoff(persisted(approvedCommit()));
    const premiumChoice = selectionId("premium", 0);
    expect(codeOf(() => sheetFrom(handoff, [premiumChoice])))
      .toBe("DOCUMENTATION_SHEET_SPECIFICATION_NOT_APPROVED");

    const partial = sheetFrom(handoff, [selectionId("preferred", 0)]);
    expect(reviewPackageCompleteness({ handoff, sheets: [partial] }).findings).toEqual([
      { code: "SPECIFICATION_NOT_COVERED", subject: selectionId("preferred", 1) },
    ]);

    const foreignHandoff = { ...handoff, approvedM2CommitRevisionId: "7e2a0000-0000-4000-8000-000000000299" };
    const foreign = sheetFrom(foreignHandoff, handoff.selectionRevisionIds, "sheet-a102");
    const report = reviewPackageCompleteness({
      handoff,
      sheets: [sheetFrom(handoff, handoff.selectionRevisionIds), foreign],
    });
    expect(report.complete).toBe(false);
    expect(report.findings).toEqual([{ code: "SHEET_FROM_OTHER_APPROVAL", subject: "sheet-a102" }]);
  });
});
