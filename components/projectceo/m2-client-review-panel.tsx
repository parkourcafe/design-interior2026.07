"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ru } from "@/lib/i18n/ru";
import { LayoutPlanThumbnail } from "@/components/layout-studio/plan-thumbnail";
import { sendProjectCeoCommand } from "./command-client";
import type { ProjectWorkspaceView } from "./contracts";
import { buildClientReviewCommand, clientReviewControlState } from "./m2-cycle6-command-builders";

// Contract copy: Рекомендуемый вариант · Рациональный вариант · Премиальный вариант
// Версия планировки · Ревизия планировки · Выборы и материалы · ₽ · Причина решения
// Согласовать · Запросить изменения · Отклонить
const roleLabel = {
  preferred: ru.projectCeo.workspace.decisions.clientPreferred,
  value_engineered: ru.projectCeo.workspace.decisions.clientValue,
  premium: ru.projectCeo.workspace.decisions.clientPremium,
} as const;

export function M2ClientReviewPanel({ view }: { readonly view: ProjectWorkspaceView }) {
  const router = useRouter();
  const [chosenVariantId, setChosenVariantId] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  if (view.actor.role !== "client" || !view.actor.packageId) return null;
  const reviewedSubmissionIds = new Set(view.m2ClientReviews.map((review) => review.submissionId));
  const submission = view.m2ClientReviewSubmissions
    .filter((item) => item.packageId === view.actor.packageId
      && item.assignedClientUserId === view.actor.actorId
      && !reviewedSubmissionIds.has(item.id))
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!submission || submission.variants.length !== 3) return null;
  const selectedSubmission = submission;
  const controls = clientReviewControlState(view, { chosenVariantId, reason });

  async function review(decision: "approved" | "change_requested" | "rejected") {
    if (!chosenVariantId || reason.trim().length < 3 || pending) return;
    setPending(true);
    try {
      // Persisted command kind: "review_m2_client_submission".
      const response = await sendProjectCeoCommand(buildClientReviewCommand(view, {
        chosenVariantId, decision, reason: reason.trim(), revisionId: crypto.randomUUID(),
      }));
      if (response.status === "completed") router.refresh();
    } finally { setPending(false); }
  }

  return <section className="mt-4 rounded-2xl border border-accent/30 bg-white p-5">
    <h2 className="font-display text-xl font-semibold">{ru.projectCeo.workspace.decisions.clientReviewTitle}</h2>
    <div className="mt-4 grid gap-3 lg:grid-cols-3">
      {selectedSubmission.variants.map((variant) => <label key={variant.variantId} className="rounded-xl border border-line p-4">
        <span className="flex gap-2"><input type="radio" name="m2-variant" value={variant.variantId} checked={chosenVariantId === variant.variantId} onChange={() => setChosenVariantId(variant.variantId)} />{roleLabel[variant.role]}</span>
        {/* §8.4: клиент выбирает по чертежу, а не по номеру ревизии. */}
        <LayoutPlanThumbnail projectId={view.project.id} layoutRevisionId={variant.layoutRevisionId} />
        <span className="mt-3 block text-xs">{ru.projectCeo.workspace.decisions.layoutVersion}: {variant.layoutVersionId}</span>
        <span className="block text-xs">{ru.projectCeo.workspace.decisions.layoutRevision}: {variant.layoutRevisionId}</span>
        <span className="mt-2 block text-xs font-medium">{ru.projectCeo.workspace.decisions.clientSelections}</span>
        {variant.selections.map((selection) => <span key={selection.revisionId} className="block text-xs text-muted">{selection.title}</span>)}
        <span className="mt-2 block font-semibold">{variant.budget.amountRub.toLocaleString("ru-RU")} ₽</span>
        {variant.budget.staleSelectionRevisionIds.length > 0 && <span className="block text-xs text-red-700">{ru.projectCeo.workspace.decisions.clientStalePrice}</span>}
        {variant.budget.missingPriceSelectionRevisionIds.length > 0 && <span className="block text-xs text-red-700">{ru.projectCeo.workspace.decisions.clientMissingPrice}</span>}
      </label>)}
    </div>
    <label className="mt-4 block text-sm">{ru.projectCeo.workspace.decisions.clientReason}<textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-line p-3" /></label>
    <div className="mt-3 flex flex-wrap gap-2">
      <button disabled={pending || !controls.approve} className="btn-primary" onClick={() => void review("approved")}>{ru.projectCeo.workspace.decisions.clientApprove}</button>
      <button disabled={pending || !controls.change} className="btn-ghost" onClick={() => void review("change_requested")}>{ru.projectCeo.workspace.decisions.clientChange}</button>
      <button disabled={pending || !controls.reject} className="btn-ghost" onClick={() => void review("rejected")}>{ru.projectCeo.workspace.decisions.clientReject}</button>
    </div>
  </section>;
}
