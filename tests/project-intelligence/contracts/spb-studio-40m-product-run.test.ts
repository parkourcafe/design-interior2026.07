import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createRoomDesignIntent,
  type DesignIntentVariantInput,
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
} from "@/lib/project-intelligence/application/m2-approval";
import {
  DecisionContractError,
  type EvidenceReference,
  type HumanActorRef,
  type SelectionRevision,
} from "@/lib/project-intelligence/modules/decisions";

// Прогон продукта на предоставленной владельцем смете студии 40 м² в СПб.
//
// Фикстура помечена synthetic: цены в ней назначены, а не наблюдены — нет ни
// поставщика по позиции, ни даты наблюдения, ни подтверждающего документа.
// Поэтому этот прогон отвечает на вопрос «работает ли продукт на таких
// данных» и НЕ является доказательством цикла 7. Внешний реальный пакет
// по-прежнему требуется отдельно.
interface FixtureItem {
  readonly lineNo: number;
  readonly sheetRow: number;
  readonly section: string | null;
  readonly title: string;
  readonly brandNote: string | null;
  readonly quantity: number | null;
  readonly unit: string | null;
  readonly unitPriceRub: number | null;
  readonly amountRub: number;
}
interface FixtureVariant {
  readonly role: "preferred" | "value_engineered" | "premium";
  readonly slug: string;
  readonly sourceSheet: string;
  readonly declaredTotalRub: number;
  readonly items: readonly FixtureItem[];
}
interface Fixture {
  readonly synthetic: boolean;
  readonly evidenceClass: string;
  readonly notEligibleFor: string;
  readonly origin: { readonly kind: string; readonly file: string; readonly checksum: string };
  readonly project: { readonly name: string; readonly areaM2: number };
  readonly room: { readonly roomId: string; readonly label: string };
  readonly variants: readonly FixtureVariant[];
}

const fixture = JSON.parse(
  readFileSync("tests/fixtures/spb-studio-40m/estimate.json", "utf8"),
) as Fixture;

const PROJECT = "project-spb-studio-40m";
const PACKAGE = "package-spb-studio-40m";
const ROOM = fixture.room.roomId;
// Дата предоставления сметы. Это НЕ дата наблюдения цены — наблюдения не было.
const SUPPLIED_AT = "2026-08-08T00:00:00.000Z";

const designer: HumanActorRef = { actorId: "actor-designer-spb", actorType: "human" };
const client: HumanActorRef = { actorId: "actor-client-spb", actorType: "human" };
const machine = { actorId: "actor-assistant", actorType: "system" } as unknown as HumanActorRef;

function evidenceFor(variant: FixtureVariant, item: FixtureItem): EvidenceReference {
  return {
    evidenceId: `evidence-estimate-${variant.slug}-${item.lineNo}`,
    sourceId: "source-detailed-estimate-40m-spb",
    sourceRevisionId: `source-detailed-estimate-40m-spb@1`,
    fragmentId: `${variant.sourceSheet}!row=${item.sheetRow}`,
  };
}

function selectionId(variant: FixtureVariant, item: FixtureItem): string {
  return `selection-${variant.slug}-${item.lineNo}@1`;
}

function selectionsFor(variant: FixtureVariant): SelectionRevision[] {
  return variant.items.map((item) => {
    const id = selectionId(variant, item);
    const evidence = evidenceFor(variant, item);
    return {
      id,
      projectId: PROJECT,
      entityId: `entity-${variant.slug}-${item.lineNo}`,
      revisionNo: 1,
      kind: "selection",
      title: item.title,
      areaId: ROOM,
      packageId: PACKAGE,
      decisionRevisionId: `decision-${variant.slug}@1`,
      // Спецификация — строка к строке, без пустых значений: пустые поля сметы
      // не попадают в ревизию, а не превращаются в «неизвестно».
      specification: Object.fromEntries(
        ([
          ["section", item.section],
          ["brandNote", item.brandNote],
          ["quantity", item.quantity],
          ["unit", item.unit],
          ["unitPriceRub", item.unitPriceRub],
        ] as const)
          .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
          .map(([key, value]) => [key, String(value)]),
      ),
      // Данные извлечены из документа, а не заявлены человеком напрямую.
      claimStatus: "extracted",
      reviewStatus: "approved",
      evidence: [evidence],
      priceObservations: [{
        id: `price-${variant.slug}-${item.lineNo}`,
        projectId: PROJECT,
        selectionRevisionId: id,
        amountRub: item.amountRub,
        observedAt: SUPPLIED_AT,
        evidence,
        supplierRef: "estimate:detailed-estimate-40m-spb",
      }],
      createdAt: SUPPLIED_AT,
      createdBy: designer,
      reason: `Позиция сметы: ${item.section ?? "без раздела"}`,
      replacesRevisionId: null,
    } satisfies SelectionRevision;
  });
}

function variantInputs(): DesignIntentVariantInput[] {
  return fixture.variants.map((variant) => ({
    variantId: `variant-${variant.slug}`,
    role: variant.role,
    projectId: PROJECT,
    packageId: PACKAGE,
    roomId: ROOM,
    layoutDocumentId: `layout-${variant.slug}`,
    layoutVersionId: `layout-${variant.slug}@1`,
    semanticHash: `sha256:${variant.slug.padEnd(64, "0")}`,
  }));
}

function buildIntent(): RoomDesignIntent {
  return createRoomDesignIntent({
    designIntentId: "intent-spb-studio-living",
    projectId: PROJECT,
    packageId: PACKAGE,
    roomId: ROOM,
    revision: {
      revisionId: "intent-spb-studio-living@1",
      revisionNo: 1,
      createdAt: SUPPLIED_AT,
      createdBy: designer,
      reason: "Три варианта комплектации студии по смете",
    },
    variants: variantInputs(),
  });
}

const allSelections = fixture.variants.flatMap(selectionsFor);
const bindings = fixture.variants.map((variant) => ({
  variantId: `variant-${variant.slug}`,
  selectionRevisionIds: variant.items.map((item) => selectionId(variant, item)),
}));

function buildBudget(asOf: string, staleAfterDays = 90): DesignIntentBudget {
  return createDesignIntentBudget({
    intent: buildIntent(),
    selections: allSelections,
    bindings,
    asOf,
    staleAfterDays,
  });
}

describe("Прогон продукта на смете студии 40 м² (СПб)", () => {
  it("фикстура честно помечена как синтетическая и непригодная для цикла 7", () => {
    expect(fixture.synthetic).toBe(true);
    expect(fixture.evidenceClass).toBe("local_fixture_not_production");
    expect(fixture.notEligibleFor).toBe("cycle7_external_real_package");
    expect(fixture.origin.kind).toBe("ai_generated_estimate");
    expect(fixture.origin.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("принимает ровно три варианта в трёх разных ролях", () => {
    const intent = buildIntent();
    expect(intent.variants).toHaveLength(3);
    expect([...intent.variants].map((variant) => variant.role).sort())
      .toEqual(["preferred", "premium", "value_engineered"]);
  });

  it("считает бюджет по каждому варианту и попадает в итоги листов до рубля", () => {
    const budget = buildBudget(SUPPLIED_AT);
    for (const variant of fixture.variants) {
      const computed = budget.variantBudgets.find((item) => item.variantId === `variant-${variant.slug}`)!;
      expect(computed.role).toBe(variant.role);
      expect(computed.amountRub).toBe(variant.declaredTotalRub);
      expect(computed.missingPriceSelectionRevisionIds).toEqual([]);
      expect(computed.staleSelectionRevisionIds).toEqual([]);
    }
    // Разброс между эконом и премиум сохраняется — движок ничего не усредняет.
    const amounts = fixture.variants.map((variant) =>
      budget.variantBudgets.find((item) => item.variantId === `variant-${variant.slug}`)!.amountRub);
    expect(Math.max(...amounts) / Math.min(...amounts)).toBeGreaterThan(6);
  });

  it("помечает все цены устаревшими, когда смету смотрят через год", () => {
    const budget = buildBudget("2027-08-08T00:00:00.000Z");
    const econom = budget.variantBudgets.find((item) => item.variantId === "variant-econom")!;
    expect(econom.staleSelectionRevisionIds.length)
      .toBe(fixture.variants.find((variant) => variant.slug === "econom")!.items.length);
  });

  it("проводит выбранный вариант через подачу, независимое согласование и коммит", () => {
    const intent = buildIntent();
    const budget = buildBudget(SUPPLIED_AT);
    const chosen = fixture.variants.find((variant) => variant.role === "preferred")!;
    const chosenSelectionIds = chosen.items.map((item) => selectionId(chosen, item));
    const chosenSelections = selectionsFor(chosen);

    const submission = createM2ApprovalSubmission({
      submissionId: "submission-spb-1",
      intent,
      chosenVariantId: `variant-${chosen.slug}`,
      selectionRevisionIds: chosenSelectionIds,
      selections: chosenSelections,
      budget,
      submittedBy: designer,
      submittedAt: "2026-08-08T09:00:00.000Z",
      reason: "Комфорт как основной вариант",
    });

    const reviewed = reviewM2ApprovalSubmission({
      submission,
      decision: "approved",
      reviewedBy: client,
      reviewedAt: "2026-08-08T10:00:00.000Z",
      reason: "Согласовано клиентом",
    });

    const commit = createApprovedM2Commit({
      approvedSubmission: reviewed,
      currentIntent: intent,
      currentSelections: chosenSelections,
      recalculatedBudget: budget,
    });

    expect(commit.chosenVariant.role).toBe("preferred");
    expect(commit.budget.amountRub).toBe(chosen.declaredTotalRub);
    expect([...commit.approvedSelectionRevisionIds].sort()).toEqual([...chosenSelectionIds].sort());
    // Коммит хранит выборы в каноническом порядке, а не в порядке подачи.
    expect([...commit.approvedSelectionRevisionIds])
      .toEqual([...commit.approvedSelectionRevisionIds].sort());
    expect(commit.submittedBy.actorId).toBe(designer.actorId);
    expect(commit.reviewedBy.actorId).toBe(client.actorId);
    expect(Object.isFrozen(commit)).toBe(true);
  });

  it("не даёт согласовать ни ассистенту, ни самому подавшему", () => {
    const intent = buildIntent();
    const budget = buildBudget(SUPPLIED_AT);
    const chosen = fixture.variants.find((variant) => variant.role === "preferred")!;
    const submission = createM2ApprovalSubmission({
      submissionId: "submission-spb-2",
      intent,
      chosenVariantId: `variant-${chosen.slug}`,
      selectionRevisionIds: chosen.items.map((item) => selectionId(chosen, item)),
      selections: selectionsFor(chosen),
      budget,
      submittedBy: designer,
      submittedAt: "2026-08-08T09:00:00.000Z",
      reason: "Комфорт как основной вариант",
    });

    expect(() => reviewM2ApprovalSubmission({
      submission, decision: "approved", reviewedBy: machine,
      reviewedAt: "2026-08-08T10:00:00.000Z", reason: "Автосогласование",
    })).toThrow(DecisionContractError);

    expect(() => reviewM2ApprovalSubmission({
      submission, decision: "approved", reviewedBy: designer,
      reviewedAt: "2026-08-08T10:00:00.000Z", reason: "Сам себе согласовал",
    })).toThrow(DecisionContractError);
  });
});
