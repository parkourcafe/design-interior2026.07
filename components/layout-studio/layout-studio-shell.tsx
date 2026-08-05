"use client";
import { useEffect, useMemo, useState } from "react";
import { ru } from "@/lib/i18n/ru";
import { EditorSession, type EditorState } from "@/lib/layout-studio/application/editor-session";
import { VersionService } from "@/lib/layout-studio/application/version-service";
import { LayoutExportService } from "@/lib/layout-studio/application/export-service";
import { BrowserLayoutRepository } from "@/lib/layout-studio/adapters/local/browser-layout-repository";
import { SvgProjectionAdapter, renderLayoutSvg } from "@/lib/layout-studio/adapters/svg/svg-projection";
import { BrowserPngExportAdapter } from "@/lib/layout-studio/adapters/svg/browser-png-export";
import { PrintExportAdapter } from "@/lib/layout-studio/adapters/svg/print-export";
import { GlbExportAdapter } from "@/lib/layout-studio/adapters/three/glb-export";
import type { ExportFormat } from "@/lib/layout-studio/application/export-service";
import type { LayoutCheckpoint, LayoutRepository } from "@/lib/layout-studio/application/ports";
import type { LayoutCommand, LayoutDocument, LayoutVersion, PlacedObject } from "@/lib/layout-studio/domain";
import { LayoutView3D } from "./layout-view-3d";

const button: React.CSSProperties = { border: "1px solid #cbc4b8", borderRadius: 10, padding: "9px 12px", background: "#fff", cursor: "pointer", fontSize: 13 };
const panel: React.CSSProperties = { border: "1px solid #d8d1c6", borderRadius: 16, padding: 16, background: "#fff" };
const command = (document: LayoutDocument, type: LayoutCommand["type"], payload: Record<string, unknown>): LayoutCommand => ({ commandId: `command.${crypto.randomUUID()}`, idempotencyKey: crypto.randomUUID(), documentId: document.documentId, expectedStateRevision: document.stateRevision, type, payload, reasonCode: "human_edit", reason: "Редактирование в Layout Studio" });

export function LayoutStudioShell({ initialDocument }: { initialDocument: LayoutDocument }) {
  const repository = useMemo<LayoutRepository>(() => new BrowserLayoutRepository(`archidom.layout-studio.${initialDocument.projectId}`), [initialDocument.projectId]);
  const session = useMemo(() => new EditorSession(initialDocument), [initialDocument]); const [state, setState] = useState<EditorState>(() => session.snapshot()); const [versions, setVersions] = useState<LayoutVersion[]>([]); const [checkpoints, setCheckpoints] = useState<LayoutCheckpoint[]>([]); const [showCeiling, setShowCeiling] = useState(false); const [status, setStatus] = useState(ru.layoutStudio.ownerHold);
  const refresh = () => setState(session.snapshot());
  const hydrateLists = async () => { setVersions(await repository.listVersions(initialDocument.documentId)); setCheckpoints(await repository.listCheckpoints(initialDocument.documentId)); };
  useEffect(() => { void (async () => { const draft = await repository.loadDraft(initialDocument.documentId); if (draft) session.replace(draft); await hydrateLists(); refresh(); })(); }, [repository, session]);
  useEffect(() => { if (!state.dirty) return; const timer = window.setTimeout(() => { void repository.saveDraft(state.document).then(() => { session.markSaved(); refresh(); setStatus("Черновик сохранён локально"); }).catch((error) => setStatus(String(error))); }, 450); return () => window.clearTimeout(timer); }, [state.document, state.dirty, repository, session]);
  const selected = state.document.objects.find((item) => item.id === state.selectionId);

  const dispatchObject = (id: string, patch: Partial<PlacedObject>) => { const result = session.dispatch(command(state.document, "UPDATE_OBJECT", { id, patch })); if (!result.ok) setStatus(result.message); else setStatus(`Revision ${result.document.stateRevision}`); refresh(); };
  const save = async () => { await repository.saveDraft(state.document); session.markSaved(); refresh(); setStatus("Черновик сохранён локально"); };
  const checkpoint = async () => { await repository.createCheckpoint(state.document, `Revision ${state.document.stateRevision}`); await hydrateLists(); setStatus("Контрольная точка создана"); };
  const restore = async (id: string) => { const item = await repository.loadCheckpoint(id); if (!item) return; const result = session.dispatch(command(state.document, "RESTORE_CHECKPOINT", { document: item.content })); if (result.ok) { refresh(); setStatus("Контрольная точка восстановлена"); } };
  const publish = async () => { const validationBlocking = state.issues.some((issue) => issue.severity === "blocking"); if (validationBlocking) { setStatus("Публикация заблокирована проверкой"); return; } const service = new VersionService(repository); const parent = versions.at(-1); await service.publish(state.document, { versionId: `version.${state.document.documentId}.${versions.length + 1}`, parentVersionId: parent?.versionId, reasonCode: "human_publish", reason: "Утверждение версии человеком" }); await hydrateLists(); setStatus("Версия опубликована"); };
  const exportVersion = async (format: ExportFormat) => { const version = versions.at(-1); if (!version) { setStatus("Сначала опубликуйте версию"); return; } const service = new LayoutExportService(repository, { svg: new SvgProjectionAdapter(), glb: new GlbExportAdapter(), png: new BrowserPngExportAdapter(), print: new PrintExportAdapter() }); const artifact = await service.export(version.versionId, format); const blob = new Blob([artifact.bytes], { type: artifact.manifest.mimeType }); const url = URL.createObjectURL(blob); const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = artifact.manifest.filename; anchor.click(); URL.revokeObjectURL(url); setStatus(`Экспортирована точная версия ${version.versionId}`); };

  return <main style={{ minHeight: "100vh", background: "#f4f1eb", color: "#24211e", padding: 24, fontFamily: "system-ui, sans-serif" }}>
    <header style={{ maxWidth: 1500, margin: "0 auto 18px", display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}><div><div style={{ color: "#756e65", fontSize: 13 }}>{ru.layoutStudio.subtitle}</div><h1 style={{ margin: "4px 0", fontSize: 30 }}>{ru.layoutStudio.title}</h1><div>{state.document.name} · rev {state.document.stateRevision}</div></div><div style={{ color: "#756e65", maxWidth: 620 }}>{status}</div></header>
    <div style={{ maxWidth: 1500, margin: "0 auto", display: "grid", gridTemplateColumns: "minmax(0,1fr) 330px", gap: 18 }}>
      <section style={panel}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <button style={button} onClick={() => { session.setView("2d"); refresh(); }}>{ru.layoutStudio.view2d}</button><button style={button} onClick={() => { session.setView("3d"); refresh(); }}>{ru.layoutStudio.view3d}</button>
          <button style={button} disabled={!state.canUndo} onClick={() => { session.undo(); refresh(); }}>{ru.layoutStudio.undo}</button><button style={button} disabled={!state.canRedo} onClick={() => { session.redo(); refresh(); }}>{ru.layoutStudio.redo}</button>
          <button style={button} onClick={() => void save()}>{ru.layoutStudio.save}</button><button style={button} onClick={() => void checkpoint()}>{ru.layoutStudio.checkpoint}</button><button style={{ ...button, background: "#24211e", color: "white" }} onClick={() => void publish()}>{ru.layoutStudio.publish}</button>
          {(["json", "svg", "png", "glb", "print"] as ExportFormat[]).map((format) => <button key={format} style={button} onClick={() => void exportVersion(format)}>{format.toUpperCase()}</button>)}
        </div>
        {state.activeView === "2d" ? <div style={{ overflow: "auto", minHeight: 560, borderRadius: 16, background: "#fbfaf7" }} onClick={(event) => { const target = (event.target as Element).closest("[data-source-id]"); session.select(target?.getAttribute("data-source-id") ?? undefined); refresh(); }} dangerouslySetInnerHTML={{ __html: renderLayoutSvg(state.document, state.selectionId) }} /> : <><button style={{ ...button, marginBottom: 8 }} onClick={() => setShowCeiling((value) => !value)}>{showCeiling ? ru.layoutStudio.hideCeiling : ru.layoutStudio.showCeiling}</button><LayoutView3D document={state.document} selectedId={state.selectionId} showCeiling={showCeiling} /></>}
      </section>
      <aside style={{ display: "grid", gap: 14, alignContent: "start" }}>
        <section style={panel}><h2 style={{ marginTop: 0, fontSize: 17 }}>{ru.layoutStudio.inspector}</h2>{selected ? <div style={{ display: "grid", gap: 10 }}><strong>{selected.label}</strong>{(["xMm", "yMm", "widthMm", "depthMm", "heightMm"] as const).map((key) => <label key={key} style={{ display: "grid", gap: 4, fontSize: 12 }}>{key}<input value={selected[key]} type="number" disabled={selected.locked} onChange={(event) => dispatchObject(selected.id, { [key]: Number(event.target.value) })} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 8 }} /></label>)}{selected.locked && <small>Объект заблокирован owner intent</small>}</div> : <p>{ru.layoutStudio.noSelection}</p>}</section>
        <section style={panel}><h2 style={{ marginTop: 0, fontSize: 17 }}>{ru.layoutStudio.validation}</h2><ul style={{ paddingLeft: 18, fontSize: 13 }}>{state.issues.length ? state.issues.map((issue, index) => <li key={`${issue.code}-${index}`} style={{ color: issue.severity === "blocking" ? "#b42318" : "#8a5b00" }}>{issue.severity}: {issue.code}</li>) : <li>PASS</li>}</ul></section>
        <section style={panel}><h2 style={{ marginTop: 0, fontSize: 17 }}>{ru.layoutStudio.checkpoints}</h2>{checkpoints.map((item) => <button key={item.checkpointId} style={{ ...button, display: "block", width: "100%", marginBottom: 6 }} onClick={() => void restore(item.checkpointId)}>{item.label}</button>)}</section>
        <section style={panel}><h2 style={{ marginTop: 0, fontSize: 17 }}>{ru.layoutStudio.versions}</h2>{versions.map((item) => <div key={item.versionId} style={{ fontSize: 12, marginBottom: 7 }}><strong>{item.versionId}</strong><br/><code>{item.semanticHash.slice(0, 16)}…</code></div>)}</section>
      </aside>
    </div>
  </main>;
}
