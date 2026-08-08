import { describe, expect, it } from "vitest";

import {
  PROJECTCEO_COMMAND_CONTRACT_VERSION,
  projectCeoCommandSchema,
} from "@/lib/project-intelligence/delivery/projectceo/command-contract";

const projectId = "71000000-0000-4000-8000-000000000001";
const packageId = "71000000-0000-4000-8000-000000000002";

const variant = (role: "preferred" | "value_engineered" | "premium", index: number) => ({
  variantId: `variant-${role}`,
  role,
  layoutDocumentId: `layout-${role}`,
  layoutVersionId: `layout-${role}@${index}`,
  layoutRevisionId: `71000000-0000-4000-8000-00000000001${index}`,
  semanticHash: `sha256:${String(index).repeat(64)}`,
  selectionRevisionIds: [`selection-${role}@1`],
  budget: {
    amountRub: 1_000_000 + index,
    staleSelectionRevisionIds: [],
    missingPriceSelectionRevisionIds: [],
  },
});

function submitCommand() {
  return {
    contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
    commandId: "71000000-0000-4000-8000-000000000020",
    projectId,
    kind: "submit_m2_client_review",
    payload: {
      packageId,
      submissionId: "m2-client-review-living-room",
      revisionId: "71000000-0000-4000-8000-000000000021",
      expectedRevisionId: null,
      approvalPackageId: "approval-living-room-4",
      roomId: "living-room",
      designIntentRevisionId: "design-intent-living-room@4",
      variants: [variant("preferred", 1), variant("value_engineered", 2), variant("premium", 3)],
      budgetAsOf: "2026-08-06T10:00:00+08:00",
      staleAfterDays: 30,
      reason: "Три точных варианта переданы клиенту",
    },
  };
}

function reviewCommand() {
  return {
    contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
    commandId: "71000000-0000-4000-8000-000000000030",
    projectId,
    kind: "review_m2_client_submission",
    payload: {
      packageId,
      submissionId: "m2-client-review-living-room",
      revisionId: "71000000-0000-4000-8000-000000000031",
      expectedRevisionId: "71000000-0000-4000-8000-000000000021",
      chosenVariantId: "variant-preferred",
      decision: "approved",
      reason: "Клиент согласовал рекомендуемый вариант",
    },
  };
}

function handoffCommand() {
  return {
    contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
    commandId: "71000000-0000-4000-8000-000000000040",
    projectId,
    kind: "publish_m2_m3_handoff",
    payload: {
      packageId,
      handoffId: "m2-m3-living-room",
      revisionId: "71000000-0000-4000-8000-000000000041",
      expectedRevisionId: null,
      approvedCommitId: "m2-approved-living-room",
      approvedCommitRevisionId: "71000000-0000-4000-8000-000000000042",
      reason: "Передача утверждённого M2 в M3",
    },
  };
}

describe("Cycle 6 persisted command contracts", () => {
  it.each([
    ["submit", submitCommand],
    ["review", reviewCommand],
    ["handoff", handoffCommand],
  ])("accepts the strict request-bound %s command", (_name, makeCommand) => {
    expect(projectCeoCommandSchema.safeParse(makeCommand()).success).toBe(true);
  });

  it("requires an exact immutable three-role submission snapshot", () => {
    const missing = submitCommand();
    missing.payload.variants.pop();
    const duplicate = submitCommand();
    duplicate.payload.variants[2] = structuredClone(duplicate.payload.variants[0]!);
    const drifted = submitCommand();
    drifted.payload.variants[0]!.layoutRevisionId = "not-a-uuid";

    expect(projectCeoCommandSchema.safeParse(missing).success).toBe(false);
    expect(projectCeoCommandSchema.safeParse(duplicate).success).toBe(false);
    expect(projectCeoCommandSchema.safeParse(drifted).success).toBe(false);
  });

  it("does not accept actor, organization, role, timestamps or hand-authored M3 content", () => {
    for (const command of [submitCommand(), reviewCommand(), handoffCommand()]) {
      Object.assign(command.payload, {
        actorId: "71000000-0000-4000-8000-000000000099",
        organizationId: "71000000-0000-4000-8000-000000000098",
        role: "owner_lead",
        createdAt: "2026-08-06T12:00:00+08:00",
      });
      expect(projectCeoCommandSchema.safeParse(command).success).toBe(false);
    }
    const handoff = handoffCommand();
    Object.assign(handoff.payload, { layout: {}, selectionRevisionIds: [] });
    expect(projectCeoCommandSchema.safeParse(handoff).success).toBe(false);
  });
});
