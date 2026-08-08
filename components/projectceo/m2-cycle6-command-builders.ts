import { PROJECTCEO_COMMAND_CONTRACT_VERSION, type ProjectCeoCommandDraft } from "@/lib/project-intelligence/delivery/projectceo/command-contract";
import type { M2ClientReviewSubmissionView, ProjectWorkspaceView } from "./contracts";
import { ru } from "@/lib/i18n/ru";

function fail(reason: string): never { throw new Error(`M2_CYCLE6_UI_${reason}`); }
function privileged(view: ProjectWorkspaceView): boolean { return view.actor.role === "owner" || view.actor.role === "architect"; }

function assignedSubmission(view: ProjectWorkspaceView): M2ClientReviewSubmissionView {
  if (view.actor.role !== "client" || !view.actor.packageId) fail("CLIENT_SCOPE_REQUIRED");
  const reviewedSubmissionIds = new Set(view.m2ClientReviews.map((review) => review.submissionId));
  const submission = view.m2ClientReviewSubmissions
    .filter((item) => item.packageId === view.actor.packageId
      && item.assignedClientUserId === view.actor.actorId
      && !reviewedSubmissionIds.has(item.id))
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!submission || submission.variants.length !== 3) fail("ASSIGNED_SUBMISSION_REQUIRED");
  return submission;
}

export function clientReviewControlState(view: ProjectWorkspaceView, input: { readonly chosenVariantId: string; readonly reason: string }) {
  let submission: M2ClientReviewSubmissionView;
  try { submission = assignedSubmission(view); } catch { return { approve: false, change: false, reject: false } as const; }
  const variant = submission.variants.find((item) => item.variantId === input.chosenVariantId);
  const valid = Boolean(variant && input.reason === input.reason.trim() && input.reason.length >= 3 && input.reason.length <= 4000);
  const clean = Boolean(variant && variant.budget.staleSelectionRevisionIds.length === 0
    && variant.budget.missingPriceSelectionRevisionIds.length === 0);
  return { approve: valid && clean, change: valid, reject: valid } as const;
}

export function buildClientReviewCommand(view: ProjectWorkspaceView, input: {
  readonly chosenVariantId: string; readonly decision: "approved" | "change_requested" | "rejected";
  readonly reason: string; readonly revisionId: string;
}): ProjectCeoCommandDraft {
  const submission = assignedSubmission(view);
  const controls = clientReviewControlState(view, input);
  if (!controls[input.decision === "approved" ? "approve" : input.decision === "change_requested" ? "change" : "reject"]) fail("REVIEW_INVALID");
  return { contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION, kind: "review_m2_client_submission",
    projectId: view.project.id, payload: { packageId: submission.packageId, submissionId: submission.id,
      revisionId: input.revisionId, expectedRevisionId: submission.revisionId, chosenVariantId: input.chosenVariantId,
      decision: input.decision, reason: input.reason } };
}

export function buildClientReviewSubmissionCommand(view: ProjectWorkspaceView, input: {
  readonly now: string; readonly submissionId: string; readonly revisionId: string;
}): ProjectCeoCommandDraft {
  if (!privileged(view)) fail("DESIGNER_SCOPE_REQUIRED");
  const approval = view.approvalPackages.find((item) => item.status === "approved");
  const intent = approval?.items.find((item) => item.targetKind === "decision_revision");
  const layouts = view.m2LayoutVersions;
  const roomId = layouts[0]?.roomId;
  if (!approval || !intent || !roomId || layouts.length !== 3
    || layouts.some((item) => item.roomId !== roomId || item.packageId !== approval.packageId || item.selectionRevisionIds.length === 0)
    || new Set(layouts.map((item) => item.role)).size !== 3) fail("EXACT_THREE_VARIANTS_REQUIRED");
  const selections = new Map(view.selections.map((item) => [item.revisionId, item]));
  const staleAfterDays = 30;
  const variants = layouts.map((layout) => {
    const exact = layout.selectionRevisionIds.map((id) => selections.get(id));
    if (exact.some((item) => !item?.priceObservation)) fail("PRICE_PROVENANCE_REQUIRED");
    return { variantId: layout.variantId, role: layout.role, layoutDocumentId: layout.documentId,
      layoutVersionId: layout.versionId, layoutRevisionId: layout.revisionId, semanticHash: layout.semanticHash,
      selectionRevisionIds: [...layout.selectionRevisionIds], budget: {
        amountRub: exact.reduce((sum, item) => sum + item!.priceObservation!.amountRub, 0),
        staleSelectionRevisionIds: exact.filter((item) => Date.parse(input.now) - Date.parse(item!.priceObservation!.checkedAt) > staleAfterDays * 86_400_000).map((item) => item!.revisionId),
        missingPriceSelectionRevisionIds: [] as string[],
      } };
  });
  return { contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION, kind: "submit_m2_client_review", projectId: view.project.id,
    payload: { packageId: approval.packageId, submissionId: input.submissionId, revisionId: input.revisionId,
      expectedRevisionId: null, approvalPackageId: approval.id, roomId, designIntentRevisionId: intent.revisionId,
      variants, budgetAsOf: input.now, staleAfterDays, reason: ru.projectCeo.workspace.decisions.cycle6SubmitReason } };
}

export function buildM3PublishCommand(view: ProjectWorkspaceView, input: { readonly handoffId: string; readonly revisionId: string }): ProjectCeoCommandDraft {
  if (!privileged(view)) fail("M3_SCOPE_REQUIRED");
  const commit = view.m2ApprovedCommits.find((item) => item.clientSubmissionId
    && !view.m2M3Handoffs.some((handoff) => handoff.approvedCommitId === item.id));
  if (!commit) fail("APPROVED_COMMIT_REQUIRED");
  return { contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION, kind: "publish_m2_m3_handoff", projectId: view.project.id,
    payload: { packageId: commit.packageId, handoffId: input.handoffId, revisionId: input.revisionId,
      expectedRevisionId: null, approvedCommitId: commit.id, approvedCommitRevisionId: commit.revisionId,
      reason: ru.projectCeo.workspace.decisions.m3PublishReason } };
}
