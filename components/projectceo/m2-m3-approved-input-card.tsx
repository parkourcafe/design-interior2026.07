"use client";

import { ru } from "@/lib/i18n/ru";
import { ProjectCeoCommandButton } from "./command-client";
import type { ProjectWorkspaceView } from "./contracts";
import { buildM3PublishCommand } from "./m2-cycle6-command-builders";

export function M2M3ApprovedInputCard({ view }: { readonly view: ProjectWorkspaceView }) {
  if (view.actor.role === "client" || view.actor.role === "builder" || view.actor.role === "guest") return null;
  if (view.actor.role !== "owner" && view.actor.role !== "architect") return null;
  const handoff = view.m2M3Handoffs.at(-1);
  const approved = view.m2ClientReviews.find((review) => review.status === "approved");
  const commit = approved ? view.m2ApprovedCommits.find((item) => item.clientSubmissionId === approved.submissionId) : undefined;
  return <section className="mt-4 rounded-2xl border border-line bg-white p-5">
    <h2 className="font-display text-xl font-semibold">{ru.projectCeo.workspace.decisions.m3ApprovedInput}</h2>
    {handoff ? <div className="mt-3 text-sm text-muted">
      <p>{handoff.approvedCommitId} · {handoff.approvedCommitRevisionId}</p>
      <p>{handoff.layoutRevisionId}</p>
      <p>{handoff.selectionRevisionIds.join(", ")}</p>
      <p>{handoff.budget.amountRub === null ? "—" : `${handoff.budget.amountRub.toLocaleString("ru-RU")} ₽`}</p>
    </div> : commit ? <ProjectCeoCommandButton command={buildM3PublishCommand(view, {
      handoffId: `m3-${crypto.randomUUID()}`, revisionId: crypto.randomUUID(),
    })}>{/* kind: "publish_m2_m3_handoff" */}{ru.projectCeo.workspace.decisions.m3Publish}</ProjectCeoCommandButton> : <p className="mt-3 text-sm text-muted">{ru.projectCeo.workspace.decisions.m3AwaitingApproval}</p>}
  </section>;
}
