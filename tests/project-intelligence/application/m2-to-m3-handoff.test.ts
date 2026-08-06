import { describe, expect, it } from "vitest";

import {
  createM2ToM3Handoff,
  M2ToM3HandoffError,
  type CreateM2ToM3HandoffInput,
} from "@/lib/project-intelligence/application/m2-to-m3-handoff";

const projectId = "62000000-0000-4000-8000-000000000001";
const packageId = "62000000-0000-4000-8000-000000000002";
const layoutRevisionId = "62000000-0000-4000-8000-000000000003";

function validInput(): CreateM2ToM3HandoffInput {
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
          semanticHash: `sha256:${"a".repeat(64)}`,
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
        semanticHash: `sha256:${"a".repeat(64)}`,
        roomId: "living-room",
        variantId: "variant-preferred",
        role: "preferred",
      },
      {
        projectId,
        packageId,
        documentId: "layout-preferred",
        versionId: "layout-preferred@4",
        revisionId: "62000000-0000-4000-8000-000000000009",
        revisionNo: 4,
        status: "draft",
        semanticHash: `sha256:${"b".repeat(64)}`,
        roomId: "living-room",
        variantId: "variant-preferred",
        role: "preferred",
      },
    ],
    selections: [
      { projectId, packageId, entityId: "lamp-preferred", revisionId: "lamp-preferred@2", revisionNo: 2, status: "approved" },
      { projectId, packageId, entityId: "sofa-preferred", revisionId: "sofa-preferred@4", revisionNo: 4, status: "approved" },
      { projectId, packageId, entityId: "sofa-preferred", revisionId: "sofa-preferred@5", revisionNo: 5, status: "draft" },
    ],
  };
}

describe("Cycle 6: exact immutable M2 to M3 handoff", () => {
  it("hands M3 only the approved exact M2 layout and selection revisions", () => {
    const handoff = createM2ToM3Handoff(validInput());

    expect(handoff).toStrictEqual({
      contractVersion: "archidom.m2-to-m3-handoff/0.1",
      projectId,
      packageId,
      roomId: "living-room",
      approvedM2CommitId: "m2-commit-living-room",
      approvedM2CommitRevisionId: "62000000-0000-4000-8000-000000000004",
      designIntentRevisionId: "design-intent-living-room@4",
      layout: {
        documentId: "layout-preferred",
        versionId: "layout-preferred@3",
        revisionId: layoutRevisionId,
        semanticHash: `sha256:${"a".repeat(64)}`,
      },
      selectionRevisionIds: ["lamp-preferred@2", "sofa-preferred@4"],
      approvedAt: "2026-08-06T11:00:00+08:00",
    });
    expect(Object.isFrozen(handoff)).toBe(true);
    expect(Object.isFrozen(handoff.layout)).toBe(true);
    expect(Object.isFrozen(handoff.selectionRevisionIds)).toBe(true);
    expect(handoff.layout.versionId).not.toBe("layout-preferred@4");
    expect(handoff.selectionRevisionIds).not.toContain("sofa-preferred@5");
  });

  it.each(["draft", "submitted", "rejected", "change_requested"] as const)(
    "rejects an M2 commit whose status is %s",
    (status) => {
      const input = validInput();
      const unapproved = { ...input.approvedCommit, status };

      expect(() => createM2ToM3Handoff({ ...input, approvedCommit: unapproved }))
        .toThrowError(expect.objectContaining({ code: "M2_M3_COMMIT_NOT_APPROVED" }));
    },
  );

  it("rejects a stale commit when the exact approved layout version is absent", () => {
    const input = validInput();

    expect(() => createM2ToM3Handoff({
      ...input,
      layoutVersions: input.layoutVersions.filter((layout) => layout.status === "draft"),
    })).toThrowError(expect.objectContaining({ code: "M2_M3_EXACT_LAYOUT_NOT_FOUND" }));
  });

  it("rejects an approved commit whose project identity differs from the handoff scope", () => {
    const input = structuredClone(validInput());
    Object.assign(input.approvedCommit, {
      projectId: "62000000-0000-4000-8000-000000000099",
    });

    expect(() => createM2ToM3Handoff(input)).toThrowError(
      expect.objectContaining({ code: "M2_M3_SCOPE_MISMATCH" }),
    );
  });

  it.each([
    ["layout project", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.layoutVersions[0]!, { projectId: "62000000-0000-4000-8000-000000000099" });
    }],
    ["layout package", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.layoutVersions[0]!, { packageId: "62000000-0000-4000-8000-000000000099" });
    }],
    ["selection project", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.selections[0]!, { projectId: "62000000-0000-4000-8000-000000000099" });
    }],
    ["selection package", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.selections[0]!, { packageId: "62000000-0000-4000-8000-000000000099" });
    }],
  ])("rejects a cross-scope %s candidate", (_caseName, mutate) => {
    const input = structuredClone(validInput());
    mutate(input);

    expect(() => createM2ToM3Handoff(input)).toThrowError(
      expect.objectContaining({ code: "M2_M3_SCOPE_MISMATCH" }),
    );
  });

  it("rejects duplicate layout and selection candidates instead of choosing by array order", () => {
    const duplicateLayout = structuredClone(validInput());
    Object.assign(duplicateLayout, {
      layoutVersions: [
        ...duplicateLayout.layoutVersions,
        structuredClone(duplicateLayout.layoutVersions[0]!),
      ],
    });
    const duplicateSelection = structuredClone(validInput());
    Object.assign(duplicateSelection, {
      selections: [
        ...duplicateSelection.selections,
        structuredClone(duplicateSelection.selections[0]!),
      ],
    });

    expect(() => createM2ToM3Handoff(duplicateLayout)).toThrowError(
      expect.objectContaining({ code: "M2_M3_DUPLICATE_LAYOUT_CANDIDATE" }),
    );
    expect(() => createM2ToM3Handoff(duplicateSelection)).toThrowError(
      expect.objectContaining({ code: "M2_M3_DUPLICATE_SELECTION_CANDIDATE" }),
    );
  });

  it("requires at least one exact selection and a clean approved budget", () => {
    const noSelections = structuredClone(validInput());
    Object.assign(noSelections.approvedCommit.payload, { approvedSelectionRevisionIds: [] });
    const staleBudget = structuredClone(validInput());
    Object.assign(staleBudget.approvedCommit.payload.budget, {
      staleSelectionRevisionIds: ["lamp-preferred@2"],
    });
    const missingBudget = structuredClone(validInput());
    Object.assign(missingBudget.approvedCommit.payload.budget, {
      missingPriceSelectionRevisionIds: ["lamp-preferred@2"],
    });

    expect(() => createM2ToM3Handoff(noSelections)).toThrowError(
      expect.objectContaining({ code: "M2_M3_SELECTIONS_EMPTY" }),
    );
    expect(() => createM2ToM3Handoff(staleBudget)).toThrowError(
      expect.objectContaining({ code: "M2_M3_BUDGET_NOT_CLEAN" }),
    );
    expect(() => createM2ToM3Handoff(missingBudget)).toThrowError(
      expect.objectContaining({ code: "M2_M3_BUDGET_NOT_CLEAN" }),
    );
  });

  it("canonicalizes approved selection revisions by Unicode code point independent of input order", () => {
    function unicodeInput(order: readonly string[]): CreateM2ToM3HandoffInput {
      const input = structuredClone(validInput());
      Object.assign(input.approvedCommit.payload, { approvedSelectionRevisionIds: [...order] });
      Object.assign(input, {
        selections: order.map((revisionId, index) => ({
          projectId,
          packageId,
          entityId: `selection-${index}`,
          revisionId,
          revisionNo: index + 1,
          status: "approved" as const,
        })),
      });
      return input;
    }
    const unsorted = ["selection.😀@1", "selection.é@1", "selection.A@1"];
    const reverse = [...unsorted].reverse();

    const first = createM2ToM3Handoff(unicodeInput(unsorted));
    const second = createM2ToM3Handoff(unicodeInput(reverse));

    expect(first.selectionRevisionIds).toEqual([
      "selection.A@1",
      "selection.é@1",
      "selection.😀@1",
    ]);
    expect(second.selectionRevisionIds).toEqual(first.selectionRevisionIds);
  });

  it.each([
    ["semantic hash", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.layoutVersions[0]!, { semanticHash: `sha256:${"f".repeat(64)}` });
    }, "M2_M3_LAYOUT_MISMATCH"],
    ["layout status", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.layoutVersions[0]!, { status: "draft" });
    }, "M2_M3_EXACT_LAYOUT_NOT_FOUND"],
    ["selection revision", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.selections[0]!, { revisionId: "lamp-preferred@3" });
    }, "M2_M3_EXACT_SELECTION_NOT_FOUND"],
    ["selection approval", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.selections[0]!, { status: "draft" });
    }, "M2_M3_EXACT_SELECTION_NOT_APPROVED"],
    ["package scope", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.approvedCommit, { packageId: "62000000-0000-4000-8000-000000000099" });
    }, "M2_M3_SCOPE_MISMATCH"],
  ] as const)("fails closed for stale or unapproved %s", (_caseName, mutate, code) => {
    const input = structuredClone(validInput());
    mutate(input);

    expect(() => createM2ToM3Handoff(input)).toThrowError(
      expect.objectContaining({ name: "M2ToM3HandoffError", code }),
    );
    expect(M2ToM3HandoffError).toBeTypeOf("function");
  });

  it.each([
    ["commit revision UUID", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.approvedCommit, { revisionId: "not-a-uuid" });
    }],
    ["layout revision UUID", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.approvedCommit.payload.chosenVariant, { layoutRevisionId: "not-a-uuid" });
    }],
    ["layout revision number", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.layoutVersions[0]!, { revisionNo: 0 });
    }],
    ["semantic hash", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.approvedCommit.payload.chosenVariant, { semanticHash: `sha256:${"A".repeat(64)}` });
    }],
    ["review timestamp", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.approvedCommit.payload, { reviewedAt: "06.08.2026" });
    }],
    ["review chronology", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.approvedCommit.payload, {
        submittedAt: "2026-08-06T12:00:00+08:00",
        reviewedAt: "2026-08-06T11:00:00+08:00",
      });
    }],
    ["stale-after days", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.approvedCommit.payload.budget, { staleAfterDays: 0 });
    }],
    ["unknown variant role", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.approvedCommit.payload.chosenVariant, { role: "standard" });
    }],
    ["blank commit id", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.approvedCommit, { id: "  " });
    }],
    ["untrimmed room id", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.approvedCommit.payload, { roomId: " living-room " });
    }],
    ["oversized design-intent revision", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.approvedCommit.payload, { designIntentRevisionId: "d".repeat(161) });
    }],
    ["short submission reason", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.approvedCommit.payload, { submissionReason: "ок" });
    }],
    ["untrimmed review reason", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.approvedCommit.payload, { reviewReason: " Клиент согласовал " });
    }],
    ["oversized review reason", (input: CreateM2ToM3HandoffInput) => {
      Object.assign(input.approvedCommit.payload, { reviewReason: "я".repeat(4001) });
    }],
  ])("rejects malformed %s at the M2/M3 trust boundary", (_caseName, mutate) => {
    const input = structuredClone(validInput());
    mutate(input);

    expect(() => createM2ToM3Handoff(input)).toThrowError(
      expect.objectContaining({ name: "M2ToM3HandoffError", code: "M2_M3_INVALID_INPUT" }),
    );
  });
});
