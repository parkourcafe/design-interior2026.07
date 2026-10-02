"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import type { ProposalSection } from "@/lib/types";
import type { DraftFile, FileDecision } from "@/lib/project-room/handover";
import type { SensitiveFlag } from "@/lib/project-room/sensitive";
import { saveHandoverDraft } from "./actions";

const t = ru.handoverPrep;
const DECISIONS: readonly FileDecision[] = ["exclude", "original", "needs_safe_copy", "safe_copy"];

// Текст КП для исполнителя, решения по подсвеченным строкам и по файлам.
// Подсветка считается на сервере по сохранённому тексту; после правки текста
// сохраните — подсветка и блокеры обновятся.
export default function HandoverEditor({
  projectId,
  sections: initialSections,
  acknowledged: initialAck,
  flags,
  files: initialFiles,
  links,
}: {
  projectId: string;
  sections: readonly ProposalSection[];
  acknowledged: readonly string[];
  flags: readonly SensitiveFlag[];
  files: readonly DraftFile[];
  links: Readonly<Record<string, string>>;
}) {
  const router = useRouter();
  const [sections, setSections] = useState<ProposalSection[]>(initialSections.map((s) => ({ ...s })));
  const [ack, setAck] = useState<string[]>([...initialAck]);
  const [files, setFiles] = useState<DraftFile[]>(initialFiles.map((f) => ({ ...f })));
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const touch = () => { setDirty(true); setStatus("idle"); };
  const ackSet = useMemo(() => new Set(ack), [ack]);

  function save() {
    startTransition(async () => {
      const result = await saveHandoverDraft(projectId, {
        sections,
        acknowledged: ack,
        decisions: files.map((f) => ({ source_path: f.source_path, decision: f.decision, reviewed: f.reviewed })),
      });
      setStatus(result.ok ? "saved" : "error");
      if (result.ok) { setDirty(false); router.refresh(); }
    });
  }

  function removeLine(flag: SensitiveFlag) {
    const sectionId = flag.where.replace(/^section:/, "");
    setSections((current) => current.map((s) => s.id !== sectionId ? s : {
      ...s,
      body: s.body.split("\n").filter((line) => line.trim() !== flag.line).join("\n"),
    }));
    touch();
  }

  async function upload(file: DraftFile, input: HTMLInputElement) {
    const chosen = input.files?.[0];
    if (!chosen) return;
    setUploading(file.source_path); setUploadError(null);
    const form = new FormData();
    form.set("projectId", projectId);
    form.set("sourcePath", file.source_path);
    form.set("file", chosen);
    const res = await fetch("/api/project-room/handover-copy", { method: "POST", body: form }).catch(() => null);
    setUploading(null);
    input.value = "";
    if (!res?.ok) { setUploadError(file.source_path); return; }
    router.refresh();
    // Решение и копию сервер уже сохранил; локальное состояние — из обновлённой страницы.
    window.location.reload();
  }

  return (
    <>
      <section className="card" data-testid="handover-step2">
        <h2 className="font-display text-xl font-semibold">{t.step2}</h2>
        <p className="mt-1 text-sm text-muted">{t.step2Hint}</p>
        <div className="mt-4 space-y-4">
          {sections.map((section, index) => (
            <div key={section.id}>
              <label className="text-sm font-medium" htmlFor={`contractor-${section.id}`}>{section.title}</label>
              <textarea
                id={`contractor-${section.id}`}
                data-section={section.id}
                className="input mt-1 min-h-[6rem] w-full"
                value={section.body}
                onChange={(e) => {
                  const next = [...sections];
                  next[index] = { ...section, body: e.target.value };
                  setSections(next); touch();
                }}
              />
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-md border border-amber-300/60 bg-amber-50/40 p-3" data-testid="handover-flags">
          <h3 className="font-medium">{t.flagsTitle}</h3>
          <p className="mt-1 text-xs text-muted">{t.flagsHint}</p>
          {flags.length === 0 ? <p className="mt-2 text-sm">{t.noFlags}</p> : (
            <ul className="mt-3 space-y-3">
              {flags.map((flag) => (
                <li key={flag.id} data-flag={flag.id} className="rounded border border-line bg-white p-2 text-sm">
                  <span className="text-xs uppercase text-muted">
                    {t.flagWhere(flag.where)} · {flag.reasons.map((r) => t.flagReasons[r] ?? r).join(", ")}
                  </span>
                  <p className="mt-1 whitespace-pre-line font-mono text-xs">{flag.line}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {flag.where.startsWith("section:") ? (
                      <button type="button" className="btn-ghost text-xs" onClick={() => removeLine(flag)}>{t.flagRemove}</button>
                    ) : <span className="text-xs text-muted">{t.flagPassportHint}</span>}
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={ackSet.has(flag.id)}
                        onChange={(e) => { setAck(e.target.checked ? [...ack, flag.id] : ack.filter((id) => id !== flag.id)); touch(); }}
                      />
                      {t.flagKeep}
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card" data-testid="handover-step3">
        <h2 className="font-display text-xl font-semibold">{t.step3}</h2>
        <p className="mt-1 text-sm text-muted">{t.step3Hint}</p>
        {files.length === 0 ? <p className="mt-3 text-sm">{t.noFiles}</p> : (
          <ul className="mt-4 space-y-4">
            {files.map((file, index) => {
              const included = file.decision === "original" || file.decision === "safe_copy";
              const set = (patch: Partial<DraftFile>) => {
                const next = [...files];
                next[index] = { ...file, ...patch } as DraftFile;
                setFiles(next); touch();
              };
              return (
                <li key={file.source_path} data-file={file.name} className="rounded border border-line bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>
                      <span className="text-xs uppercase text-muted">{ru.handover.fileKind[file.kind] ?? file.kind}</span>{" "}
                      {file.name}{file.size ? ` · ${Math.max(1, Math.round(file.size / 1024))} КБ` : ""}
                    </span>
                    {links[file.source_path] ? (
                      <a className="underline" href={links[file.source_path]} target="_blank" rel="noopener noreferrer">{t.open}</a>
                    ) : null}
                  </div>
                  <select
                    className="input mt-2 w-full"
                    aria-label={file.name}
                    value={file.decision}
                    onChange={(e) => set({ decision: e.target.value as FileDecision, reviewed: false })}
                  >
                    {DECISIONS.filter((d) => d !== "safe_copy" || file.safe_copy).map((d) => (
                      <option key={d} value={d}>{t.decision[d]}</option>
                    ))}
                  </select>
                  {file.decision === "needs_safe_copy" || file.decision === "safe_copy" ? (
                    <div className="mt-2">
                      {file.safe_copy ? (
                        <p>
                          {t.copyLoaded(file.safe_copy.name)}
                          {links[file.safe_copy.path] ? <> · <a className="underline" href={links[file.safe_copy.path]} target="_blank" rel="noopener noreferrer">{t.open}</a></> : null}
                        </p>
                      ) : null}
                      <label className="mt-1 block text-xs">
                        {file.safe_copy ? t.replaceCopy : t.uploadCopy}
                        <input
                          type="file"
                          accept="application/pdf,image/png,image/jpeg,image/webp"
                          className="mt-1 block"
                          disabled={uploading !== null || dirty}
                          data-upload-for={file.name}
                          onChange={(e) => void upload(file, e.currentTarget)}
                        />
                      </label>
                      {dirty ? <p className="text-xs text-muted">{t.unsaved}</p> : null}
                      {uploading === file.source_path ? <p className="text-xs">{t.uploading}</p> : null}
                      {uploadError === file.source_path ? <p role="alert" className="text-xs text-red-700">{t.uploadError}</p> : null}
                    </div>
                  ) : null}
                  {included ? (
                    <label className="mt-2 flex items-start gap-2 text-xs">
                      <input type="checkbox" checked={file.reviewed} onChange={(e) => set({ reviewed: e.target.checked })} />
                      {t.reviewed}
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" disabled={pending} onClick={save}>{pending ? t.saving : t.save}</button>
          {dirty ? <span className="text-xs text-amber-800">{t.unsaved}</span> : null}
          {status === "saved" ? <span role="status" className="text-xs text-muted">{t.saved}</span> : null}
          {status === "error" ? <span role="alert" className="text-xs text-red-700">{t.saveError}</span> : null}
        </div>
      </section>
    </>
  );
}
