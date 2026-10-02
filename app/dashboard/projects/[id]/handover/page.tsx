import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStudio } from "@/lib/studio";
import { ru } from "@/lib/i18n/ru";
import PassportView from "@/components/passport-view";
import { KIT_BUCKET, finalFiles } from "@/lib/project-room/handover";
import { loadHandoverState } from "@/lib/project-room/handover-state";
import { CORRECTION_FIELDS, readCorrectionField, type CorrectionField } from "@/lib/project-room/passport-correction";
import HandoverEditor from "./editor";
import PassportCorrections from "./passport-corrections";
import HandoverConfirm from "./confirm";

export const dynamic = "force-dynamic";

const t = ru.handoverPrep;

// Подготовка комплекта подрядчика (решение владельца 02.10.2026, B-1/B-2):
// сверка принятого КП со сводкой паспорта, текст и файлы для исполнителя,
// итог и подтверждение. Комплект создаётся только из подтверждённой сверки.
export default async function HandoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const studio = await getStudio();
  if (!studio) redirect("/login");
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("id").eq("id", id).maybeSingle();
  if (!project) notFound();

  const loaded = await loadHandoverState(supabase, id, { createDraftAs: studio.userId });
  if (!loaded.ok) {
    const message = loaded.reason === "proposal_not_accepted" ? t.notAccepted : loaded.reason === "no_passport" ? t.noPassport : t.draftFailed;
    return (
      <div>
        <Link href={`/dashboard/projects/${id}/proposal`} className="text-sm text-muted hover:text-ink">{t.back}</Link>
        <p className="mt-4 text-sm">{message}</p>
      </div>
    );
  }
  const { state } = loaded;

  // Ссылки на файлы для проверки — сессией дизайнера, на 15 минут.
  const links: Record<string, string> = {};
  for (const file of state.files) {
    for (const path of [file.source_path, file.safe_copy?.path]) {
      if (!path || links[path]) continue;
      const { data } = await supabase.storage.from(KIT_BUCKET).createSignedUrl(path, 900);
      if (data?.signedUrl) links[path] = data.signedUrl;
    }
  }

  const corrections = Object.keys(CORRECTION_FIELDS).map((field) => ({
    field: field as CorrectionField,
    value: readCorrectionField(state.passport, field as CorrectionField) ?? null,
  }));
  const { data: correctionRows } = await supabase.from("project_passport_corrections")
    .select("field, before_value, after_value, created_at").eq("project_id", id)
    .order("created_at", { ascending: false }).limit(10);

  const final = finalFiles(state.files);
  const locked = Boolean(state.kit);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/dashboard/projects/${id}/proposal`} className="text-sm text-muted hover:text-ink">{t.back}</Link>
        <h1 className="mt-1 font-display text-3xl font-semibold">{t.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.lead}</p>
      </div>

      {state.kit ? (
        <section className="card border-accent/30">
          <p className="text-sm">{t.kitDone(new Date(state.kit.createdAt).toLocaleString("ru-RU"))}</p>
          {state.reconciliation.state === "stale" && state.reconciliation.reason === "passport_changed" ? (
            <p className="mt-2 text-sm text-amber-800">{ru.handover.passportChangedAfterKit}</p>
          ) : null}
          <Link href={`/dashboard/projects/${id}/room`} className="btn-primary mt-3 inline-block">{t.openRoom}</Link>
        </section>
      ) : null}

      <section className="card" data-testid="handover-step1">
        <h2 className="font-display text-xl font-semibold">{t.step1}</h2>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="font-medium">{t.clientProposal(state.proposal.version)}</h3>
            <p className="mb-3 text-xs text-muted">{t.clientProposalHint}</p>
            <div className="space-y-3 rounded-md border border-line bg-white p-3" data-testid="client-proposal">
              {state.proposal.sections.map((section) => (
                <div key={section.id}>
                  <h4 className="text-sm font-medium">{section.title}</h4>
                  <p className="whitespace-pre-line text-sm text-ink/90">{section.body}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="font-medium">{t.contractorPassport}</h3>
            <p className="mb-3 text-xs text-muted">{t.contractorPassportHint}</p>
            <div data-testid="contractor-passport"><PassportView passport={state.summary} audience="contractor" /></div>
            {!locked ? (
              <PassportCorrections projectId={id} fields={corrections} />
            ) : null}
            {(correctionRows ?? []).length > 0 ? (
              <div className="mt-3 text-xs text-muted">
                <p className="font-medium">{t.correctionsLog}</p>
                <ul className="mt-1 space-y-1">
                  {(correctionRows as { field: string; before_value: unknown; after_value: unknown; created_at: string }[]).map((row) => (
                    <li key={`${row.field}:${row.created_at}`}>
                      {new Date(row.created_at).toLocaleString("ru-RU")} · {t.fields[row.field] ?? row.field}:{" "}
                      {t.options[String(row.before_value)] ?? String(row.before_value ?? "—")} → {t.options[String(row.after_value)] ?? String(row.after_value)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {!locked ? (
        <HandoverEditor
          projectId={id}
          sections={state.draft.contractor_sections}
          acknowledged={state.draft.acknowledged ?? []}
          flags={state.flags}
          files={state.files}
          links={links}
        />
      ) : null}

      <section className="card" data-testid="handover-final">
        <h2 className="font-display text-xl font-semibold">{t.step4}</h2>
        <p className="mt-1 text-sm text-muted">{t.step4Hint}</p>
        <h3 className="mt-4 font-medium">{t.finalText}</h3>
        <div className="mt-2 space-y-3 rounded-md border border-line bg-white p-3" data-testid="final-text">
          {state.draft.contractor_sections.map((section) => (
            <div key={section.id}>
              <h4 className="text-sm font-medium">{section.title}</h4>
              <p className="whitespace-pre-line text-sm text-ink/90">{section.body}</p>
            </div>
          ))}
        </div>
        <h3 className="mt-4 font-medium">{t.finalFiles}</h3>
        {final.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{t.finalNoFiles}</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm" data-testid="final-files">
            {final.map((file) => (
              <li key={file.path}>
                {ru.handover.fileKind[file.kind] ?? file.kind}: {file.name}
                {file.variant === "safe_copy" ? ` (${ru.handover.safeCopyOf(file.sourceName)})` : ""}
                {file.size ? ` · ${Math.max(1, Math.round(file.size / 1024))} КБ` : ""}
                {links[file.path] ? <> · <a className="underline" href={links[file.path]} target="_blank" rel="noopener noreferrer">{t.open}</a></> : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">{ru.handover.notIncluded}</p>
        {!locked ? (
          <HandoverConfirm
            projectId={id}
            proposalVersion={state.proposal.version}
            blockers={state.blockers.map((b) => ({
              code: b.code,
              detail: b.code === "flags_unresolved" ? String(b.count) : "names" in b ? b.names.join(", ") : "",
            }))}
            reconciliation={state.reconciliation}
          />
        ) : null}
      </section>
    </div>
  );
}
