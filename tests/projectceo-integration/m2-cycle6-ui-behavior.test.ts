import { describe, expect, it } from "vitest";
import type { ProjectWorkspaceView } from "@/components/projectceo/contracts";

const projectId = "82000000-0000-4000-8000-000000000001";
const packageId = "82000000-0000-4000-8000-000000000002";

function workspace(role: "owner" | "architect" | "client" | "builder" | "guest"): ProjectWorkspaceView {
  return {
    project: { id: projectId },
    actor: {
      actorId: role === "client" ? "82000000-0000-4000-8000-000000000004" : "82000000-0000-4000-8000-000000000003",
      role,
      packageId: role === "client" ? packageId : null,
    },
    approvalPackages: [{
      id: "approval-cycle6", packageId, status: "approved", selfApproved: false,
      items: [
        { targetKind: "decision_revision", entityId: "decision", revisionId: "decision-r4" },
        { targetKind: "selection_revision", entityId: "selection", revisionId: "selection-r7" },
      ], createdAt: "2026-08-06T08:00:00Z",
    }],
    selections: [{ revisionId: "selection-r7", priceObservation: { amountRub: 125_000, checkedAt: "2026-08-06T08:30:00Z", sourceCode: "supplier:1" } }],
    m2LayoutVersions: ["preferred", "value_engineered", "premium"].map((variantRole, index) => ({
      packageId, roomId: "living-room", variantId: `variant-${variantRole}`,
      role: variantRole, documentId: `layout-${variantRole}`, versionId: `layout-${variantRole}@2`,
      revisionId: `82000000-0000-4000-8000-00000000001${index}`,
      semanticHash: `sha256:${String(index + 1).repeat(64)}`, selectionRevisionIds: ["selection-r7"], status: "published",
    })),
    m2ClientReviewSubmissions: [{
      id: "submission-cycle6", revisionId: "submission-r1", packageId,
      assignedClientUserId: "82000000-0000-4000-8000-000000000004", status: "submitted",
      variants: [
        { variantId: "variant-preferred", role: "preferred", layoutDocumentId: "layout-preferred", layoutVersionId: "layout-preferred@2", layoutRevisionId: "82000000-0000-4000-8000-000000000010", semanticHash: `sha256:${"1".repeat(64)}`, selectionRevisionIds: ["selection-r7"], selections: [{ revisionId: "selection-r7", title: "Диван" }], budget: { amountRub: 125_000, staleSelectionRevisionIds: [], missingPriceSelectionRevisionIds: [] } },
        { variantId: "variant-value_engineered", role: "value_engineered", layoutDocumentId: "layout-value_engineered", layoutVersionId: "layout-value_engineered@2", layoutRevisionId: "82000000-0000-4000-8000-000000000011", semanticHash: `sha256:${"2".repeat(64)}`, selectionRevisionIds: ["selection-r7"], selections: [{ revisionId: "selection-r7", title: "Диван" }], budget: { amountRub: 125_000, staleSelectionRevisionIds: [], missingPriceSelectionRevisionIds: [] } },
        { variantId: "variant-premium", role: "premium", layoutDocumentId: "layout-premium", layoutVersionId: "layout-premium@2", layoutRevisionId: "82000000-0000-4000-8000-000000000012", semanticHash: `sha256:${"3".repeat(64)}`, selectionRevisionIds: ["selection-r7"], selections: [{ revisionId: "selection-r7", title: "Диван" }], budget: { amountRub: 125_000, staleSelectionRevisionIds: [], missingPriceSelectionRevisionIds: [] } },
      ],
    }],
    m2ClientReviews: [],
    m2ApprovedCommits: [{ id: "approved-submission-cycle6", revisionId: "review-r1", packageId, status: "approved", clientSubmissionId: "submission-cycle6" }],
    m2M3Handoffs: [],
  } as unknown as ProjectWorkspaceView;
}

async function builders() {
  return import("@/components/projectceo/m2-cycle6-command-builders");
}

describe("Cycle 6 UI command behavior", () => {
  it.each(["approved", "change_requested", "rejected"] as const)(
    "assigned client chooses one variant, supplies a reason and builds %s",
    async (decision) => {
      const { buildClientReviewCommand } = await builders();
      const command = buildClientReviewCommand(workspace("client"), {
        chosenVariantId: "variant-preferred", decision, reason: "Решение клиента по гостиной",
        revisionId: "82000000-0000-4000-8000-000000000020",
      });
      expect(command).toMatchObject({
        kind: "review_m2_client_submission", projectId,
        payload: { packageId, submissionId: "submission-cycle6", expectedRevisionId: "submission-r1", chosenVariantId: "variant-preferred", decision, reason: "Решение клиента по гостиной" },
      });
      expect(JSON.stringify(command)).not.toMatch(/actorId|actorUserId|service_role/);
    },
  );

  it("disables approval for dirty budget and all decisions until variant and reason are valid", async () => {
    const { clientReviewControlState } = await builders();
    const clean = workspace("client");
    expect(clientReviewControlState(clean, { chosenVariantId: "", reason: "" })).toMatchObject({ approve: false, change: false, reject: false });
    const dirty = structuredClone(clean);
    (dirty.m2ClientReviewSubmissions[0]!.variants[0]!.budget.staleSelectionRevisionIds as string[]).push("selection-r7");
    expect(clientReviewControlState(dirty, { chosenVariantId: "variant-preferred", reason: "Нужно решение клиента" })).toMatchObject({ approve: false, change: true, reject: true });
  });

  it("targets the newest pending assigned submission shown by the client panel", async () => {
    const { buildClientReviewCommand } = await builders();
    const view = workspace("client");
    const older = structuredClone(view.m2ClientReviewSubmissions[0]!);
    (older as { id: string }).id = "submission-older";
    (older as { revisionId: string }).revisionId = "submission-older-r1";
    (older as { createdAt: string }).createdAt = "2026-08-06T09:00:00Z";
    const newer = structuredClone(view.m2ClientReviewSubmissions[0]!);
    (newer as { id: string }).id = "submission-newer";
    (newer as { revisionId: string }).revisionId = "submission-newer-r1";
    (newer as { createdAt: string }).createdAt = "2026-08-06T10:00:00Z";
    (view as { m2ClientReviewSubmissions: typeof view.m2ClientReviewSubmissions }).m2ClientReviewSubmissions = [older, newer];

    expect(buildClientReviewCommand(view, {
      chosenVariantId: "variant-preferred", decision: "approved",
      reason: "Согласован новый пакет", revisionId: "82000000-0000-4000-8000-000000000021",
    })).toMatchObject({ payload: { submissionId: "submission-newer", expectedRevisionId: "submission-newer-r1" } });
  });

  it("builds submit only for owner/architect and publish only for owner/architect", async () => {
    const { buildClientReviewSubmissionCommand, buildM3PublishCommand } = await builders();
    for (const role of ["owner", "architect"] as const) {
      expect(buildClientReviewSubmissionCommand(workspace(role), { now: "2026-08-06T10:00:00Z", submissionId: "submission-new", revisionId: "82000000-0000-4000-8000-000000000030" })).toMatchObject({ kind: "submit_m2_client_review", payload: { approvalPackageId: "approval-cycle6", designIntentRevisionId: "decision-r4", variants: expect.arrayContaining([expect.objectContaining({ budget: expect.objectContaining({ amountRub: 125_000 }) })]) } });
      expect(buildM3PublishCommand(workspace(role), { handoffId: "handoff-new", revisionId: "82000000-0000-4000-8000-000000000031" })).toMatchObject({ kind: "publish_m2_m3_handoff", payload: { approvedCommitId: "approved-submission-cycle6", approvedCommitRevisionId: "review-r1" } });
    }
    for (const role of ["client", "builder", "guest"] as const) {
      expect(() => buildClientReviewSubmissionCommand(workspace(role), { now: "2026-08-06T10:00:00Z", submissionId: "x", revisionId: "82000000-0000-4000-8000-000000000030" })).toThrow();
      expect(() => buildM3PublishCommand(workspace(role), { handoffId: "x", revisionId: "82000000-0000-4000-8000-000000000031" })).toThrow();
    }
  });
});
