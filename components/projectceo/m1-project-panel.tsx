"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ru } from "@/lib/i18n/ru";
import { PROJECTCEO_COMMAND_CONTRACT_VERSION } from "@/lib/project-intelligence/delivery/projectceo/command-contract";
import { sendProjectCeoCommand, ProjectCeoCommandButton } from "./command-client";
import { Badge } from "./badges";
import { M1PassportPanel } from "./m1-passport-panel";
import type {
  M1ProjectFactView,
  M1ApprovalRequestView,
  ProjectCeoRole,
  ProjectWorkspaceView,
} from "./contracts";

const copy = ru.projectCeo;

function shortId(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function factTypeLabel(fact: M1ProjectFactView): string {
  return copy.workspace.m1.factTypes[fact.factType];
}

function approvalStatusTone(status: M1ApprovalRequestView["status"]): "neutral" | "success" | "warning" | "danger" {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  if (status === "submitted") return "warning";
  return "neutral";
}

function FactForm({ view }: { readonly view: ProjectWorkspaceView }) {
  const router = useRouter();
  const [factType, setFactType] = useState<M1ProjectFactView["factType"]>("requirement");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || !title.trim() || reason.trim().length < 3) return;
    setPending(true);
    setError(false);
    try {
      const response = await sendProjectCeoCommand({
        contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
        kind: "create_project_fact",
        projectId: view.project.id,
        payload: {
          factType,
          content: { title: title.trim(), detail: detail.trim() || undefined },
          extractionKind: "human_stated",
          sourceId: null,
          sourceRevisionId: null,
          statedReason: reason.trim(),
          supersedesFactId: null,
        },
      });
      if (response.status !== "completed") {
        setError(true);
        return;
      }
      setTitle("");
      setDetail("");
      setReason("");
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-line p-4">
      <p className="text-xs font-medium text-muted">{copy.workspace.m1.createFact}</p>
      <label className="block text-xs text-muted">
        {copy.workspace.m1.factType}
        <select
          value={factType}
          onChange={(event) => setFactType(event.target.value as M1ProjectFactView["factType"])}
          disabled={pending}
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink"
        >
          {(Object.keys(copy.workspace.m1.factTypes) as M1ProjectFactView["factType"][]).map((type) => (
            <option key={type} value={type}>{copy.workspace.m1.factTypes[type]}</option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-muted">
        {copy.workspace.m1.factTitle}
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={copy.workspace.m1.titlePlaceholder}
          disabled={pending}
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink"
          required
        />
      </label>
      <label className="block text-xs text-muted">
        {copy.workspace.m1.detail}
        <textarea
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          placeholder={copy.workspace.m1.detailPlaceholder}
          disabled={pending}
          className="mt-1 min-h-20 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
        />
      </label>
      <label className="block text-xs text-muted">
        {copy.workspace.m1.statedReason}
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={copy.workspace.m1.statedReasonPlaceholder}
          disabled={pending}
          className="mt-1 min-h-20 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
          required
        />
      </label>
      <button type="submit" disabled={pending || !title.trim() || reason.trim().length < 3} className="btn-primary">
        {pending ? copy.workspace.m1.creating : copy.workspace.m1.createFact}
      </button>
      {error && <p role="alert" className="text-xs text-red-700">{copy.common.commandUnavailable}</p>}
    </form>
  );
}

function Facts({ view }: { readonly view: ProjectWorkspaceView }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{copy.workspace.m1.factsTitle}</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">{copy.workspace.m1.heading}</h2>
        </div>
        <Badge tone="accent">{view.m1.facts.length}</Badge>
      </div>
      {view.m1.facts.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{copy.workspace.m1.noFacts}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {view.m1.facts.map((fact) => (
            <li key={fact.id} className="rounded-xl bg-paper p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{fact.title}</p>
                  <p className="mt-1 text-xs text-muted">{factTypeLabel(fact)} · {fact.extractionKind}</p>
                </div>
                {fact.supersededAt && <Badge tone="neutral">{copy.workspace.m1.superseded}</Badge>}
              </div>
              {fact.detail && <p className="mt-2 text-sm leading-6 text-muted">{fact.detail}</p>}
              <p className="mt-2 text-xs text-muted">
                {fact.sourceId && fact.sourceRevisionId
                  ? copy.workspace.m1.sourceRevision(shortId(fact.sourceId), shortId(fact.sourceRevisionId))
                  : copy.workspace.m1.humanStated(fact.statedReason ?? copy.common.dash)}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted">{shortId(fact.id)}</p>
            </li>
          ))}
        </ul>
      )}
      {view.operations.create_project_fact.status === "available" && <FactForm view={view} />}
    </section>
  );
}

function ApprovalRequest({
  view,
  request,
  role,
}: {
  readonly view: ProjectWorkspaceView;
  readonly request: M1ApprovalRequestView;
  readonly role: ProjectCeoRole;
}) {
  const [decisionReason, setDecisionReason] = useState("");
  const submitState = view.operations.submit_approval_request;
  const decideState = view.operations.decide_approval_request;
  const canSubmit = submitState.status === "available" && submitState.commandTargetId === request.id;
  const canDecide = decideState.status === "available" && decideState.commandTargetId === request.id;
  const canDecideAsOwnerOrArchitect = role === "owner" || role === "architect";
  const subjectLabel = request.subjectKind === "project_passport"
    ? copy.workspace.m1.subjectProjectPassport
    : copy.workspace.m1.subjectClientPassport;
  return (
    <li className="rounded-xl bg-paper p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{subjectLabel}</p>
          <p className="mt-1 text-xs text-muted">{copy.workspace.m1.requested}: {request.requestedReason}</p>
        </div>
        <Badge tone={approvalStatusTone(request.status)}>{copy.workspace.m1.status[request.status]}</Badge>
      </div>
      <p className="mt-2 font-mono text-[11px] text-muted">{shortId(request.id)} · {shortId(request.subjectId)}</p>
      {request.selfApproved && <p className="mt-2 text-xs text-amber-800">{copy.workspace.m1.selfApproved}</p>}
      {request.decidedBy && <p className="mt-1 text-xs text-muted">{copy.workspace.m1.decidedBy(request.decidedBy)}</p>}
      {request.decisionReason && <p className="mt-1 text-xs text-muted">{request.decisionReason}</p>}
      {canSubmit && (
        <ProjectCeoCommandButton
          command={{
            contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
            kind: "submit_approval_request",
            projectId: view.project.id,
            payload: { requestId: request.id },
          }}
          className="mt-3 rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink"
        >
          {copy.workspace.m1.submitApproval}
        </ProjectCeoCommandButton>
      )}
      {canDecide && canDecideAsOwnerOrArchitect && (
        <div className="mt-3 space-y-2">
          <label className="block text-xs text-muted">
            {copy.workspace.m1.decisionReason}
            <textarea
              value={decisionReason}
              onChange={(event) => setDecisionReason(event.target.value)}
              placeholder={copy.workspace.m1.decisionReasonPlaceholder}
              minLength={3}
              required
              className="mt-1 min-h-20 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {(["approved", "rejected"] as const).map((decision) => (
              <ProjectCeoCommandButton
                key={decision}
                command={{
                  contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
                  kind: "decide_approval_request",
                  projectId: view.project.id,
                  payload: {
                    requestId: request.id,
                    decision,
                    reason: decisionReason.trim(),
                  },
                }}
                disabled={decisionReason.trim().length < 3}
                confirmation={copy.workspace.m1.decisionConfirmation}
                className={decision === "approved"
                  ? "rounded-lg border border-emerald-200 px-3 py-2 text-xs font-medium text-emerald-700"
                  : "rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700"}
              >
                {decision === "approved" ? copy.workspace.m1.approve : copy.workspace.m1.reject}
              </ProjectCeoCommandButton>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

function Approvals({ view, role }: { readonly view: ProjectWorkspaceView; readonly role: ProjectCeoRole }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{copy.workspace.m1.approvalsTitle}</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">{copy.workspace.m1.heading}</h2>
        </div>
        <Badge tone="warning">{view.m1.approvalRequests.length}</Badge>
      </div>
      {view.m1.approvalRequests.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{copy.workspace.m1.noApprovals}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {view.m1.approvalRequests.map((request) => (
            <ApprovalRequest key={request.id} view={view} request={request} role={role} />
          ))}
        </ul>
      )}
      {view.operations.create_approval_request.status === "available" && (
        <ProjectCeoCommandButton
          command={{
            contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
            kind: "create_approval_request",
            projectId: view.project.id,
            payload: {
              subjectKind: "project_passport",
              subjectId: view.project.id,
              reason: copy.workspace.m1.lead,
            },
          }}
          className="btn-primary mt-4"
        >
          {copy.workspace.m1.createApproval}
        </ProjectCeoCommandButton>
      )}
    </section>
  );
}

export function M1ProjectPanel({
  view,
  role,
}: {
  readonly view: ProjectWorkspaceView;
  readonly role: ProjectCeoRole;
}) {
  if (role !== "owner" && role !== "architect") return null;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <M1PassportPanel m1={view.m1} />
      <Facts view={view} />
      <Approvals view={view} role={role} />
    </div>
  );
}
