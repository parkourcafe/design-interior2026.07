import { describe, expect, it } from "vitest";

import {
  buildM2ClientReviewAction,
  buildM2ClientReviewModel,
  M2ClientReviewError,
  type M2ClientReviewInput,
} from "@/components/projectceo/m2-client-review";

const projectId = "61000000-0000-4000-8000-000000000001";
const packageId = "61000000-0000-4000-8000-000000000002";
const roomId = "living-room";
const submitterActorId = "61000000-0000-4000-8000-000000000003";
const reviewerActorId = "61000000-0000-4000-8000-000000000004";

function reviewInput(overrides: Partial<M2ClientReviewInput> = {}): M2ClientReviewInput {
  return {
    locale: "ru",
    scope: {
      actorRole: "client_approver",
      actorId: reviewerActorId,
      accessScope: "package",
      projectId,
      packageId,
      capabilities: ["view_project", "review_selection"],
    },
    reviewPackage: {
      approvalPackageId: "approval-living-room-4",
      projectId,
      packageId,
      roomId,
      status: "submitted",
      submittedByActorId: submitterActorId,
      submittedAt: "2026-08-06T09:30:00+08:00",
      designIntentRevisionId: "design-intent-living-room@4",
      variants: [
        {
          variantId: "variant-premium",
          role: "premium",
          layoutDocumentId: "layout-premium",
          layoutVersionId: "layout-premium@2",
          layoutRevisionId: "61000000-0000-4000-8000-000000000012",
          semanticHash: `sha256:${"c".repeat(64)}`,
          selectionRevisionIds: ["sofa-premium@2", "lamp-premium@1"],
          selections: [
            { revisionId: "sofa-premium@2", title: "Диван из натуральной кожи", supplierRef: "supplier-premium-sofa" },
            { revisionId: "lamp-premium@1", title: "Подвесной светильник", supplierRef: "supplier-premium-light" },
          ],
          budget: {
            amountRub: 1_840_000,
            staleSelectionRevisionIds: [],
            missingPriceSelectionRevisionIds: [],
          },
        },
        {
          variantId: "variant-preferred",
          role: "preferred",
          layoutDocumentId: "layout-preferred",
          layoutVersionId: "layout-preferred@3",
          layoutRevisionId: "61000000-0000-4000-8000-000000000013",
          semanticHash: `sha256:${"a".repeat(64)}`,
          selectionRevisionIds: ["sofa-preferred@4", "lamp-preferred@2"],
          selections: [
            { revisionId: "sofa-preferred@4", title: "Модульный диван", supplierRef: "supplier-sofa" },
            { revisionId: "lamp-preferred@2", title: "Трековый свет", supplierRef: "supplier-light" },
          ],
          budget: {
            amountRub: 1_420_000,
            staleSelectionRevisionIds: ["lamp-preferred@2"],
            missingPriceSelectionRevisionIds: [],
          },
        },
        {
          variantId: "variant-value",
          role: "value_engineered",
          layoutDocumentId: "layout-value",
          layoutVersionId: "layout-value@1",
          layoutRevisionId: "61000000-0000-4000-8000-000000000014",
          semanticHash: `sha256:${"b".repeat(64)}`,
          selectionRevisionIds: ["sofa-value@1", "lamp-value@1"],
          selections: [
            { revisionId: "sofa-value@1", title: "Компактный диван", supplierRef: "supplier-value-sofa" },
            { revisionId: "lamp-value@1", title: "Накладной свет", supplierRef: "supplier-value-light" },
          ],
          budget: {
            amountRub: 1_080_000,
            staleSelectionRevisionIds: [],
            missingPriceSelectionRevisionIds: ["lamp-value@1"],
          },
        },
      ],
      budgetAsOf: "2026-08-06T10:00:00+08:00",
      staleAfterDays: 30,
    },
    ...overrides,
  };
}

describe("Cycle 6: Russian M2 client review UI", () => {
  it("shows exactly three controlled variants with exact selections, RUB budgets and warnings", () => {
    const model = buildM2ClientReviewModel(reviewInput());

    expect(model).toStrictEqual({
      locale: "ru",
      title: "Согласование дизайн-концепции",
      approvalPackageId: "approval-living-room-4",
      roomId,
      statusLabel: "Ожидает вашего решения",
      variants: [
        expect.objectContaining({
          role: "preferred",
          label: "Рекомендуемый вариант",
          layoutVersionId: "layout-preferred@3",
          layoutRevisionId: "61000000-0000-4000-8000-000000000013",
          selectionRevisionIds: ["sofa-preferred@4", "lamp-preferred@2"],
          selectionTitles: ["Модульный диван", "Трековый свет"],
          budgetLabel: "1 420 000 ₽",
          warnings: ["Цена устарела: Трековый свет"],
        }),
        expect.objectContaining({
          role: "value_engineered",
          label: "Рациональный вариант",
          layoutVersionId: "layout-value@1",
          layoutRevisionId: "61000000-0000-4000-8000-000000000014",
          selectionRevisionIds: ["sofa-value@1", "lamp-value@1"],
          selectionTitles: ["Компактный диван", "Накладной свет"],
          budgetLabel: "1 080 000 ₽",
          warnings: ["Нет актуальной цены: Накладной свет"],
        }),
        expect.objectContaining({
          role: "premium",
          label: "Премиальный вариант",
          layoutVersionId: "layout-premium@2",
          layoutRevisionId: "61000000-0000-4000-8000-000000000012",
          selectionRevisionIds: ["sofa-premium@2", "lamp-premium@1"],
          selectionTitles: ["Диван из натуральной кожи", "Подвесной светильник"],
          budgetLabel: "1 840 000 ₽",
          warnings: [],
        }),
      ],
      actions: [
        { decision: "approved", label: "Согласовать" },
        { decision: "change_requested", label: "Запросить изменения" },
        { decision: "rejected", label: "Отклонить" },
      ],
    });
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.variants)).toBe(true);
    expect(Object.isFrozen(model.variants[0])).toBe(true);
    expect(Object.isFrozen(model.variants[0]!.selectionRevisionIds)).toBe(true);
    expect(Object.isFrozen(model.variants[0]!.warnings)).toBe(true);
    expect(Object.isFrozen(model.actions)).toBe(true);
  });

  it.each(["approved", "change_requested", "rejected"] as const)(
    "binds %s to one exact chosen variant without trusting a client reviewer identity",
    (decision) => {
      const input = reviewInput();
      const chosenVariantId = decision === "approved" ? "variant-premium" : "variant-preferred";
      const expected = decision === "approved"
        ? {
          variantId: "variant-premium",
          role: "premium",
          layoutDocumentId: "layout-premium",
          layoutVersionId: "layout-premium@2",
          layoutRevisionId: "61000000-0000-4000-8000-000000000012",
          semanticHash: `sha256:${"c".repeat(64)}`,
          selectionRevisionIds: ["sofa-premium@2", "lamp-premium@1"],
        }
        : {
          variantId: "variant-preferred",
          role: "preferred",
          layoutDocumentId: "layout-preferred",
          layoutVersionId: "layout-preferred@3",
          layoutRevisionId: "61000000-0000-4000-8000-000000000013",
          semanticHash: `sha256:${"a".repeat(64)}`,
          selectionRevisionIds: ["sofa-preferred@4", "lamp-preferred@2"],
        };
      const action = buildM2ClientReviewAction(input, {
        decision,
        chosenVariantId,
        reason: "Решение клиента по варианту гостиной",
      });

      expect(action).toStrictEqual({
        kind: "review_m2_design",
        projectId,
        payload: {
          packageId,
          approvalPackageId: "approval-living-room-4",
          roomId,
          designIntentRevisionId: "design-intent-living-room@4",
          chosenVariant: expected,
          decision,
          reason: "Решение клиента по варианту гостиной",
        },
      });
      expect(action).not.toHaveProperty("reviewerActorId");
      expect(action.payload).not.toHaveProperty("reviewerActorId");
      expect(action.payload).not.toHaveProperty("submittedByActorId");
      expect(Object.isFrozen(action)).toBe(true);
      expect(Object.isFrozen(action.payload.chosenVariant)).toBe(true);
    },
  );

  it("blocks approval of stale or unpriced selections but still permits change request and rejection", () => {
    const input = reviewInput();

    for (const chosenVariantId of ["variant-preferred", "variant-value"] as const) {
      expect(() => buildM2ClientReviewAction(input, {
        decision: "approved",
        chosenVariantId,
        reason: "Попытка согласовать вариант с неактуальным бюджетом",
      })).toThrowError(expect.objectContaining({ code: "M2_CLIENT_REVIEW_BUDGET_NOT_CLEAN" }));
    }
    for (const decision of ["change_requested", "rejected"] as const) {
      expect(() => buildM2ClientReviewAction(input, {
        decision,
        chosenVariantId: "variant-preferred",
        reason: "Бюджет требует уточнения до согласования",
      })).not.toThrow();
    }
  });

  it.each([
    ["blank", "  "],
    ["too short", "ок"],
    ["untrimmed", " Причина согласования "],
    ["too long", "я".repeat(4001)],
  ])("rejects a %s client action reason", (_caseName, reason) => {
    expect(() => buildM2ClientReviewAction(reviewInput(), {
      decision: "approved",
      chosenVariantId: "variant-premium",
      reason,
    })).toThrowError(expect.objectContaining({ code: "M2_CLIENT_REVIEW_REASON_INVALID" }));
  });

  it("rejects self-review and an action whose chosen variant is absent", () => {
    const input = reviewInput();

    expect(() => buildM2ClientReviewAction({
      ...input,
      scope: { ...input.scope, actorId: submitterActorId },
    }, {
      decision: "approved",
      chosenVariantId: "variant-preferred",
      reason: "Попытка самостоятельного согласования",
    })).toThrowError(expect.objectContaining({ code: "M2_CLIENT_REVIEWER_MUST_DIFFER" }));
    expect(() => buildM2ClientReviewAction(input, {
      decision: "approved",
      chosenVariantId: "variant-not-submitted",
      reason: "Варианта нет в отправленном пакете",
    })).toThrowError(expect.objectContaining({ code: "M2_CLIENT_REVIEW_VARIANT_NOT_FOUND" }));
  });

  it.each([
    ["wrong package", { packageId: "61000000-0000-4000-8000-000000000009" }],
    ["project-wide client scope", { accessScope: "project" as const }],
    ["designer session", { actorRole: "architect" as const }],
    ["guest exact-package session", { actorRole: "guest" as const, capabilities: ["view_project"] as const }],
    ["missing review capability", { capabilities: ["view_project"] as const }],
  ])("fails closed instead of exposing review actions for %s", (_caseName, scopeOverride) => {
    const input = reviewInput();
    const scope = { ...input.scope, ...scopeOverride };

    expect(() => buildM2ClientReviewModel({ ...input, scope })).toThrowError(
      expect.objectContaining({ name: "M2ClientReviewError", code: "M2_CLIENT_REVIEW_FORBIDDEN" }),
    );
  });

  it("rejects anything other than exactly one preferred, value-engineered and premium variant", () => {
    const input = reviewInput();
    const duplicated = {
      ...input,
      reviewPackage: {
        ...input.reviewPackage,
        variants: [
          input.reviewPackage.variants[0]!,
          input.reviewPackage.variants[1]!,
          { ...input.reviewPackage.variants[2]!, role: "preferred" as const },
        ],
      },
    };

    expect(() => buildM2ClientReviewModel(duplicated)).toThrowError(
      expect.objectContaining({ name: "M2ClientReviewError", code: "M2_CLIENT_REVIEW_VARIANTS_INVALID" }),
    );
    expect(M2ClientReviewError).toBeTypeOf("function");
  });

  it.each([
    ["malformed project id", (input: M2ClientReviewInput) => {
      Object.assign(input.scope, { projectId: "not-a-uuid" });
    }],
    ["malformed layout hash", (input: M2ClientReviewInput) => {
      Object.assign(input.reviewPackage.variants[0]!, { semanticHash: `sha256:${"A".repeat(64)}` });
    }],
    ["malformed budget timestamp", (input: M2ClientReviewInput) => {
      Object.assign(input.reviewPackage, { budgetAsOf: "06.08.2026" });
    }],
    ["non-positive stale days", (input: M2ClientReviewInput) => {
      Object.assign(input.reviewPackage, { staleAfterDays: 0 });
    }],
    ["warning outside variant selections", (input: M2ClientReviewInput) => {
      Object.assign(input.reviewPackage.variants[0]!.budget, {
        staleSelectionRevisionIds: ["selection-from-another-variant@1"],
      });
    }],
    ["duplicate layout version", (input: M2ClientReviewInput) => {
      Object.assign(input.reviewPackage.variants[0]!, {
        layoutVersionId: input.reviewPackage.variants[1]!.layoutVersionId,
        layoutRevisionId: input.reviewPackage.variants[1]!.layoutRevisionId,
      });
    }],
    ["duplicate variant id", (input: M2ClientReviewInput) => {
      Object.assign(input.reviewPackage.variants[0]!, {
        variantId: input.reviewPackage.variants[1]!.variantId,
      });
    }],
    ["duplicate layout document id", (input: M2ClientReviewInput) => {
      Object.assign(input.reviewPackage.variants[0]!, {
        layoutDocumentId: input.reviewPackage.variants[1]!.layoutDocumentId,
      });
    }],
    ["untrimmed room id", (input: M2ClientReviewInput) => {
      Object.assign(input.reviewPackage, { roomId: " living-room " });
    }],
    ["oversized variant id", (input: M2ClientReviewInput) => {
      Object.assign(input.reviewPackage.variants[0]!, { variantId: "v".repeat(161) });
    }],
    ["unknown runtime role", (input: M2ClientReviewInput) => {
      Object.assign(input.scope, { actorRole: "CLIENT_APPROVER" });
    }],
  ])("fails closed for %s", (_caseName, mutate) => {
    const input = structuredClone(reviewInput());
    mutate(input);

    expect(() => buildM2ClientReviewModel(input)).toThrowError(
      expect.objectContaining({ name: "M2ClientReviewError" }),
    );
  });
});
