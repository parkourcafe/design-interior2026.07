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

function M2ExpansionPanel({ view }: { readonly view: ProjectWorkspaceView }) {
  const router = useRouter();
  const packageId = packageIdFor(view);
  const [roomName, setRoomName] = useState("");
  const [roomArea, setRoomArea] = useState("20");
  const [variantTitle, setVariantTitle] = useState("");
  const [variantDescription, setVariantDescription] = useState("");
  const [variantRoomId, setVariantRoomId] = useState("");
  const [materialName, setMaterialName] = useState("");
  const [materialSupplier, setMaterialSupplier] = useState("");
  const [materialUnit, setMaterialUnit] = useState("м²");
  const [materialCost, setMaterialCost] = useState("0");
  const [materialQuantity, setMaterialQuantity] = useState("1");
  const [materialVariantId, setMaterialVariantId] = useState("");
  const [budgetMin, setBudgetMin] = useState("0");
  const [budgetMax, setBudgetMax] = useState("0");
  const [contingency, setContingency] = useState("10");
  const [handoffTitle, setHandoffTitle] = useState("");
  const [handoffNote, setHandoffNote] = useState("");
  const [state, setState] = useState<"idle" | "pending" | "error">("idle");
  const approved = view.approvalPackages.find((item) => item.status === "approved") ?? null;
  const can = (kind: keyof ProjectWorkspaceView["operations"]): boolean => view.operations[kind].status === "available";

  async function send(command: Parameters<typeof sendProjectCeoCommand>[0]): Promise<void> {
    if (state === "pending") return;
    setState("pending");
    try {
      const response = await sendProjectCeoCommand(command);
      if (response.status !== "completed") throw new Error("command_failed");
      setState("idle");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  const base = { contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION, projectId: view.project.id } as const;
  return (
    <div className="mt-4 space-y-4 rounded-xl border border-line bg-white p-4">
      <div>
        <p className="text-xs font-medium text-muted">{copy.workspace.decisions.expansionTitle}</p>
        <p className="mt-1 text-xs text-muted">{copy.workspace.decisions.expansionBody}</p>
      </div>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (packageId && roomName.trim()) void send({ ...base, kind: "create_m2_room", payload: { packageId, roomId: `room-${crypto.randomUUID()}`, revisionId: crypto.randomUUID(), expectedRevisionId: null, name: roomName.trim(), areaM2: Math.max(1, Number(roomArea)), reason: "Human-authored M2 room" } }); }}>
        <label className="text-xs text-muted">{copy.workspace.decisions.roomName}<input value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder={copy.workspace.decisions.roomNamePlaceholder} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
        <label className="text-xs text-muted">{copy.workspace.decisions.roomArea}<input type="number" min="1" value={roomArea} onChange={(event) => setRoomArea(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
        <button type="submit" disabled={!packageId || !can("create_m2_room") || !roomName.trim() || state === "pending"} className="btn-ghost sm:col-span-2">{copy.workspace.decisions.createRoomSubmit}</button>
      </form>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (packageId && variantRoomId && variantTitle.trim()) void send({ ...base, kind: "create_m2_variant", payload: { packageId, variantId: `variant-${crypto.randomUUID()}`, revisionId: crypto.randomUUID(), expectedRevisionId: null, roomId: variantRoomId, title: variantTitle.trim(), description: variantDescription.trim(), reason: "Human-authored M2 variant" } }); }}>
        <label className="text-xs text-muted">{copy.workspace.decisions.variantRoom}<select value={variantRoomId} onChange={(event) => setVariantRoomId(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm text-ink"><option value="">—</option>{view.m2Rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
        <label className="text-xs text-muted">{copy.workspace.decisions.variantTitle}<input value={variantTitle} onChange={(event) => setVariantTitle(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
        <label className="text-xs text-muted sm:col-span-2">{copy.workspace.decisions.variantDescription}<input value={variantDescription} onChange={(event) => setVariantDescription(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
        <button type="submit" disabled={!packageId || !can("create_m2_variant") || !variantRoomId || !variantTitle.trim() || state === "pending"} className="btn-ghost sm:col-span-2">{copy.workspace.decisions.createVariantSubmit}</button>
      </form>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (packageId && materialVariantId && materialName.trim()) void send({ ...base, kind: "create_m2_material", payload: { packageId, materialId: `material-${crypto.randomUUID()}`, revisionId: crypto.randomUUID(), expectedRevisionId: null, variantId: materialVariantId, name: materialName.trim(), supplierRef: materialSupplier.trim(), unit: materialUnit.trim() || "шт", unitCostRub: Math.max(0, Number(materialCost)), quantity: Math.max(1, Number(materialQuantity)), reason: "Human-authored M2 material" } }); }}>
        <label className="text-xs text-muted">{copy.workspace.decisions.materialVariant}<select value={materialVariantId} onChange={(event) => setMaterialVariantId(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm text-ink"><option value="">—</option>{view.m2Variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.title}</option>)}</select></label>
        <label className="text-xs text-muted">{copy.workspace.decisions.materialName}<input value={materialName} onChange={(event) => setMaterialName(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
        <label className="text-xs text-muted">{copy.workspace.decisions.supplierRef}<input value={materialSupplier} onChange={(event) => setMaterialSupplier(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
        <label className="text-xs text-muted">{copy.workspace.decisions.unit}<input value={materialUnit} onChange={(event) => setMaterialUnit(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
        <label className="text-xs text-muted">{copy.workspace.decisions.unitCostRub}<input type="number" min="0" value={materialCost} onChange={(event) => setMaterialCost(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
        <label className="text-xs text-muted">{copy.workspace.decisions.quantity}<input type="number" min="1" value={materialQuantity} onChange={(event) => setMaterialQuantity(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
        <button type="submit" disabled={!packageId || !can("create_m2_material") || !materialVariantId || !materialName.trim() || state === "pending"} className="btn-ghost sm:col-span-2">{copy.workspace.decisions.createMaterialSubmit}</button>
      </form>
      <form className="grid gap-3 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); if (packageId) void send({ ...base, kind: "set_m2_budget", payload: { packageId, budgetId: `budget-${crypto.randomUUID()}`, revisionId: crypto.randomUUID(), expectedRevisionId: null, minRub: Math.max(0, Number(budgetMin)), maxRub: Math.max(0, Number(budgetMax)), contingencyPct: Math.min(100, Math.max(0, Number(contingency))), reason: "Human-authored M2 budget" } }); }}>
        <label className="text-xs text-muted">{copy.workspace.decisions.budgetMin}<input type="number" min="0" value={budgetMin} onChange={(event) => setBudgetMin(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
        <label className="text-xs text-muted">{copy.workspace.decisions.budgetMax}<input type="number" min="0" value={budgetMax} onChange={(event) => setBudgetMax(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
        <label className="text-xs text-muted">{copy.workspace.decisions.contingency}<input type="number" min="0" max="100" value={contingency} onChange={(event) => setContingency(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
        <button type="submit" disabled={!packageId || !can("set_m2_budget") || Number(budgetMax) < Number(budgetMin) || state === "pending"} className="btn-ghost sm:col-span-3">{copy.workspace.decisions.createBudgetSubmit}</button>
      </form>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (packageId && approved && handoffTitle.trim()) void send({ ...base, kind: "create_m2_client_handoff", payload: { packageId, handoffId: `handoff-${crypto.randomUUID()}`, revisionId: crypto.randomUUID(), expectedRevisionId: null, approvalPackageId: approved.id, title: handoffTitle.trim(), note: handoffNote.trim(), reason: "Human-authored M2 client handoff" } }); }}>
        <label className="text-xs text-muted">{copy.workspace.decisions.handoffTitle}<input value={handoffTitle} onChange={(event) => setHandoffTitle(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
        <label className="text-xs text-muted">{copy.workspace.decisions.handoffNote}<textarea value={handoffNote} onChange={(event) => setHandoffNote(event.target.value)} className="mt-1 min-h-16 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink" /></label>
        <button type="submit" disabled={!packageId || !approved || !can("create_m2_client_handoff") || !handoffTitle.trim() || state === "pending"} className="btn-primary w-full">{copy.workspace.decisions.createHandoffSubmit}</button>
        {!approved && <p className="text-xs text-muted">{copy.workspace.decisions.noApprovedPackage}</p>}
      </form>
      {state === "error" && <ComposerMessage error />}
      {(view.m2Rooms.length > 0 || view.m2Variants.length > 0 || view.m2Materials.length > 0 || view.m2BudgetFrames.length > 0 || view.m2ClientHandoffs.length > 0) && <div className="grid gap-2 text-xs text-muted sm:grid-cols-2"><p>{copy.workspace.decisions.roomsCount}: {view.m2Rooms.length}</p><p>{copy.workspace.decisions.variantsCount}: {view.m2Variants.length}</p><p>{copy.workspace.decisions.materialsCount}: {view.m2Materials.length}</p><p>{copy.workspace.decisions.budgetsCount}: {view.m2BudgetFrames.length}</p><p>{copy.workspace.decisions.handoffsCount}: {view.m2ClientHandoffs.length}</p></div>}
    </div>
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
      <M2ExpansionPanel view={view} />
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
