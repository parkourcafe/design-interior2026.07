import { describe, expect, it } from "vitest";

import {
  createM2ToM3Handoff,
  type CreateM2ToM3HandoffInput,
} from "@/lib/project-intelligence/application/m2-to-m3-handoff";
import {
  registerDocumentationSheet,
  type DocumentationSheetHandoffInput,
} from "@/lib/project-intelligence/modules/documentation";

const projectId = "62000000-0000-4000-8000-000000000001";
const packageId = "62000000-0000-4000-8000-000000000002";
const layoutRevisionId = "62000000-0000-4000-8000-000000000003";
const signature = `sha256:${"a".repeat(64)}`;

function approvedHandoffInput(): CreateM2ToM3HandoffInput {
  return {
    projectId,
    packageId,
    approvedCommit: {
      id: "m2-commit-living-room",
      projectId,
      packageId,
      revisionId: "62000000-0000-4000-8000-000000000004",
      revisionNo: 1,
      status: "approved",
      payload: {
        approvalPackageId: "approval-living-room-4",
        roomId: "living-room",
        designIntentRevisionId: "design-intent-living-room@4",
        chosenVariant: {
          variantId: "variant-preferred",
          role: "preferred",
          layoutDocumentId: "layout-preferred",
          layoutVersionId: "layout-preferred@3",
          layoutRevisionId,
          semanticHash: signature,
        },
        approvedSelectionRevisionIds: ["lamp-preferred@2", "sofa-preferred@4"],
        budget: {
          asOf: "2026-08-06T10:00:00+08:00",
          staleAfterDays: 30,
          amountRub: 1_420_000,
          staleSelectionRevisionIds: [],
          missingPriceSelectionRevisionIds: [],
        },
        submittedAt: "2026-08-06T10:30:00+08:00",
        reviewedAt: "2026-08-06T11:00:00+08:00",
        submissionReason: "Три варианта и подборы готовы к согласованию",
        reviewReason: "Клиент согласовал рекомендуемый вариант",
      },
      createdAt: "2026-08-06T03:00:01.000Z",
    },
    layoutVersions: [
      {
        projectId,
        packageId,
        documentId: "layout-preferred",
        versionId: "layout-preferred@3",
        revisionId: layoutRevisionId,
        revisionNo: 3,
        status: "published",
        semanticHash: signature,
        roomId: "living-room",
        variantId: "variant-preferred",
        role: "preferred",
      },
    ],
    selections: [
      {
        projectId,
        packageId,
        entityId: "lamp",
        revisionId: "lamp-preferred@2",
        revisionNo: 2,
        status: "approved",
      },
      {
        projectId,
        packageId,
        entityId: "sofa",
        revisionId: "sofa-preferred@4",
        revisionNo: 4,
        status: "approved",
      },
    ],
  };
}

/**
 * Модуль документации объявляет форму входа своим типом, чтобы домен не
 * зависел от слоя application. Этот тест — та самая привязка, о которой
 * говорит комментарий в контракте: настоящий handoff обязан подходить к нему
 * без переходников. Если формы разойдутся, тест перестанет компилироваться.
 */
describe("Лист документации принимает настоящий handoff M2→M3", () => {
  it("выход createM2ToM3Handoff подходит на вход без преобразования", () => {
    const handoff = createM2ToM3Handoff(approvedHandoffInput());
    const asSheetInput: DocumentationSheetHandoffInput = handoff;

    const sheet = registerDocumentationSheet({
      sheetId: "sheet-living-room-plan",
      sheetNumber: "A-101",
      title: "План гостиной",
      roomId: handoff.roomId,
      revision: {
        revisionId: "62000000-0000-4000-8000-00000000000a",
        revisionNo: 1,
        createdAt: "2026-08-09T11:00:00Z",
        createdBy: { actorId: "architect-1", actorType: "human" },
        reason: "Первый лист пакета по утверждённой планировке.",
      },
      handoff: asSheetInput,
      specificationRevisionIds: ["lamp-preferred@2"],
    });

    expect(sheet.origin.semanticHash).toBe(signature);
    expect(sheet.origin.layoutVersionId).toBe("layout-preferred@3");
    expect(sheet.origin.handoffContractVersion).toBe("archidom.m2-to-m3-handoff/0.1");
    expect(sheet.roomId).toBe("living-room");
    expect(sheet.projectId).toBe(projectId);
  });
});
