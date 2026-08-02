"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProjectWorkspaceView } from "./contracts";
import { ProjectCeoCommandButton, sendProjectCeoCommand } from "./command-client";
import { PROJECTCEO_COMMAND_CONTRACT_VERSION } from "@/lib/project-intelligence/delivery/projectceo/command-contract";
import { ru } from "@/lib/i18n/ru";

const copy = ru.projectCeo;

function packageIdFor(view: ProjectWorkspaceView): string | null {
  return view.actor.packageId
    ?? view.packages.find((item) => item.kind === "project_root")?.id
    ?? view.packages[0]?.id
    ?? null;
}

function ComposerMessage({ error }: { readonly error: boolean }) {
  return error ? (
    <p role="status" className="text-xs text-red-700">{copy.common.commandUnavailable}</p>
  ) : null;
}

function DecisionComposer({ view }: { readonly view: ProjectWorkspaceView }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [resolution, setResolution] = useState("");
  const [state, setState] = useState<"idle" | "pending" | "error">("idle");
  const packageId = packageIdFor(view);
  const available = view.operations.create_decision.status === "available";

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!available || !packageId || !title.trim() || !resolution.trim() || state === "pending") return;
    setState("pending");
    try {
      const response = await sendProjectCeoCommand({
        contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
        kind: "create_decision",
        projectId: view.project.id,
        payload: {
          packageId,
          nodeId: `decision-${crypto.randomUUID()}`,
          revisionId: crypto.randomUUID(),
          expectedRevisionId: null,
          claimStatus: "human_origin",
          title: title.trim(),
          resolution: resolution.trim(),
          areaNodeId: view.decisions[0]?.areaNodeId ?? view.selections[0]?.areaNodeId ?? null,
          decisionStatus: "proposed",
          evidence: [],
          reason: "Human-authored M2 decision",
        },
      });
      if (response.status !== "completed") throw new Error("command_failed");
      setTitle("");
      setResolution("");
      setState("idle");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-line bg-paper p-4">
      <p className="text-xs font-medium text-muted">{copy.workspace.decisions.writeSliceTitle}</p>
      <label className="block text-xs text-muted">
        {copy.workspace.decisions.decisionTitle}
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={copy.workspace.decisions.decisionTitlePlaceholder}
          disabled={!available || state === "pending"}
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink"
        />
      </label>
      <label className="block text-xs text-muted">
        {copy.workspace.decisions.decisionResolution}
        <textarea
          value={resolution}
          onChange={(event) => setResolution(event.target.value)}
          placeholder={copy.workspace.decisions.decisionResolutionPlaceholder}
          disabled={!available || state === "pending"}
          className="mt-1 min-h-20 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
        />
      </label>
      <button
        type="submit"
        disabled={!available || !packageId || !title.trim() || !resolution.trim() || state === "pending"}
        className="btn-ghost w-full"
      >
        {state === "pending" ? copy.actions.refresh : copy.workspace.decisions.createDecisionSubmit}
      </button>
      <ComposerMessage error={state === "error"} />
    </form>
  );
}

function SelectionComposer({ view }: { readonly view: ProjectWorkspaceView }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [material, setMaterial] = useState("");
  const [finish, setFinish] = useState("");
  const [state, setState] = useState<"idle" | "pending" | "error">("idle");
  const decision = view.decisions.at(-1) ?? null;
  const available = view.operations.create_selection.status === "available";
  const canSubmit = available && decision?.areaNodeId && title.trim() && material.trim() && finish.trim();

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit || !decision || state === "pending") return;
    setState("pending");
    try {
      const response = await sendProjectCeoCommand({
        contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
        kind: "create_selection",
        projectId: view.project.id,
        payload: {
          packageId: decision.packageId,
          nodeId: `selection-${crypto.randomUUID()}`,
          revisionId: crypto.randomUUID(),
          expectedRevisionId: null,
          claimStatus: "human_origin",
          title: title.trim(),
          areaNodeId: decision.areaNodeId,
          decisionRevisionId: decision.revisionId,
          specification: { material: material.trim(), finish: finish.trim() },
          evidence: [],
          reason: "Human-authored M2 selection",
        },
      });
      if (response.status !== "completed") throw new Error("command_failed");
      setTitle("");
      setMaterial("");
      setFinish("");
      setState("idle");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-line bg-paper p-4">
      <p className="text-xs font-medium text-muted">{copy.workspace.decisions.selectionApproval}</p>
      <label className="block text-xs text-muted">
        {copy.workspace.decisions.selectionTitle}
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={copy.workspace.decisions.selectionTitlePlaceholder} disabled={!available || state === "pending"} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-muted">
          {copy.workspace.decisions.selectionMaterial}
          <input value={material} onChange={(event) => setMaterial(event.target.value)} disabled={!available || state === "pending"} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink" />
        </label>
        <label className="block text-xs text-muted">
          {copy.workspace.decisions.selectionFinish}
          <input value={finish} onChange={(event) => setFinish(event.target.value)} disabled={!available || state === "pending"} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink" />
        </label>
      </div>
      <button type="submit" disabled={!canSubmit || state === "pending"} className="btn-ghost w-full">
        {state === "pending" ? copy.actions.refresh : copy.workspace.decisions.createSelectionSubmit}
      </button>
      {!decision?.areaNodeId && <p className="text-xs text-muted">{copy.workspace.decisions.workflowUnavailable}</p>}
      <ComposerMessage error={state === "error"} />
    </form>
  );
}

export function M2WorkflowPanel({ view }: { readonly view: ProjectWorkspaceView }) {
  const decision = view.decisions.at(-1) ?? null;
  const selection = view.selections.at(-1) ?? null;
  const packageId = packageIdFor(view);
  const approval = view.approvalPackages.at(-1) ?? null;
  const canCreateApproval = view.operations.create_approval_package.status === "available"
    && decision !== null && selection !== null && packageId !== null;
  return (
    <section className="mt-4 rounded-2xl border border-accent/30 bg-accent/5 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{copy.workspace.decisions.writeSliceTitle}</p>
      <p className="mt-2 text-sm leading-6 text-muted">{copy.workspace.decisions.writeSliceBody}</p>
      <DecisionComposer view={view} />
      <SelectionComposer view={view} />
      {canCreateApproval && (!approval || approval.status === "approved" || approval.status === "rejected" || approval.status === "change_requested") && (
        <ProjectCeoCommandButton
          command={{
            contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
            kind: "create_approval_package",
            projectId: view.project.id,
            payload: {
              packageId,
              approvalPackageId: `approval-${crypto.randomUUID()}`,
              items: [
                { targetKind: "decision_revision", entityId: decision.id, revisionId: decision.revisionId },
                { targetKind: "selection_revision", entityId: selection.id, revisionId: selection.revisionId },
              ],
            },
          }}
          disabled={!canCreateApproval}
          className="btn-primary mt-4 w-full"
        >
          {copy.workspace.decisions.createApprovalSubmit}
        </ProjectCeoCommandButton>
      )}
      {approval && (
        <div className="mt-4 rounded-xl border border-line bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold">{copy.workspace.decisions.approvalPackage}</p>
            <span className="rounded-full bg-paper px-3 py-1 text-xs font-medium">{approval.status}</span>
          </div>
          {approval.status === "draft" && (
            <ProjectCeoCommandButton
              command={{
                contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
                kind: "submit_approval_package",
                projectId: view.project.id,
                payload: { approvalPackageId: approval.id, expectedStatus: "draft" },
              }}
              disabled={view.operations.submit_approval_package.status !== "available"}
              className="btn-ghost mt-3 w-full"
            >
              {copy.workspace.decisions.submitApprovalSubmit}
            </ProjectCeoCommandButton>
          )}
          {approval.status === "submitted" && (
            <ProjectCeoCommandButton
              command={{
                contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
                kind: "review_selection",
                projectId: view.project.id,
                payload: {
                  approvalPackageId: approval.id,
                  expectedStatus: "submitted",
                  decision: "approved",
                  reason: "Human review completed in M2 workspace",
                },
              }}
              disabled={view.operations.review_selection.status !== "available"}
              className="btn-primary mt-3 w-full"
            >
              {copy.workspace.decisions.humanReviewSubmit}
            </ProjectCeoCommandButton>
          )}
          {approval.selfApproved && <p className="mt-3 text-xs text-muted">{copy.workspace.decisions.selfApproved}</p>}
        </div>
      )}
    </section>
  );
}
