"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProposalSection } from "@/lib/types";
import { saveProposal, sendProposal, rebuildProposal } from "./actions";
import { extendProposalLink, revokeProposalLink } from "./link-actions";
import { isPublicLinkActive } from "@/lib/proposal/public-link";
import { ru } from "@/lib/i18n/ru";

export default function ProposalEditor({
  projectId,
  initialSections,
  publicUrl,
  alreadySent,
  linkExpiresAt = null,
}: {
  projectId: string;
  initialSections: ProposalSection[];
  publicUrl: string;
  alreadySent: boolean;
  linkExpiresAt?: string | null;
}) {
  const [linkPending, startLinkTransition] = useTransition();
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkActive = isPublicLinkActive(linkExpiresAt);

  function changeLink(action: "extend" | "revoke") {
    if (action === "revoke" && !window.confirm(ru.proposal.revokeConfirm)) return;
    setLinkError(null);
    startLinkTransition(async () => {
      const result = action === "extend" ? await extendProposalLink(projectId) : await revokeProposalLink(projectId);
      if (!result.ok) setLinkError(ru.proposal.linkActionFailed);
      router.refresh();
    });
  }
  const [sections, setSections] = useState(initialSections);
  const [saved, setSaved] = useState(false);
  const [sent, setSent] = useState(alreadySent);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function edit(id: string, body: string) {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, body } : s)));
    setSaved(false);
  }

  // Сервер отклоняет правки не-черновика; интерфейс фиксирует это состояние
  // и перечитывает страницу, чтобы показать клиентскую версию текста.
  function lockAsSent() {
    setSent(true);
    router.refresh();
  }

  function save() {
    startTransition(async () => {
      const res = await saveProposal(projectId, sections);
      if (res.ok) setSaved(true);
      else if (res.reason === "not_draft") lockAsSent();
    });
  }

  function send() {
    startTransition(async () => {
      setSendError(null);
      const draft = await saveProposal(projectId, sections);
      if (!draft.ok && draft.reason === "not_draft") {
        lockAsSent();
        return;
      }
      const res = await sendProposal(projectId);
      if (res.ok) {
        setSent(true);
        router.refresh();
      } else if (res.reason === "approval_required") {
        setSendError(ru.proposal.approvalRequired);
      } else if (res.reason === "not_draft") {
        lockAsSent();
      }
    });
  }

  function rebuild() {
    if (
      !window.confirm(
        "Пересобрать предложение из актуальных данных (цена, принятые риски)?\n\nВаши ручные правки текста будут заменены заново собранным вариантом.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await rebuildProposal(projectId);
      if (res.ok && res.sections) {
        setSections(res.sections);
        setSaved(true);
      } else if (res.reason === "sent") {
        window.alert("КП уже отправлено — пересборка недоступна.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center gap-3">
        {!sent && (
          <>
            <button onClick={save} disabled={pending} className="btn-ghost">
              {pending ? ru.proposal.saving : saved ? ru.proposal.saved : ru.proposal.save}
            </button>
            <button onClick={rebuild} disabled={pending} className="btn-ghost">
              Пересобрать
            </button>
          </>
        )}
        <button onClick={() => window.print()} className="btn-ghost">
          {ru.proposal.print}
        </button>
        <button onClick={send} disabled={pending || sent} className="btn-primary">
          {sent ? ru.proposal.sent : pending ? ru.proposal.sending : ru.proposal.send}
        </button>
        {sendError && <p role="alert" className="basis-full text-sm text-amber-800">{sendError}</p>}
        {sent && <p className="basis-full text-sm text-muted">{ru.proposal.lockedAfterSend}</p>}
      </div>

      <div className="no-print rounded-md border border-line bg-white p-3 text-sm">
        {sent ? (
          <>
            <span className="text-muted">{ru.proposal.publicLink}: </span>
            <a href={publicUrl} target="_blank" rel="noreferrer" className="break-all text-accent">
              {publicUrl}
            </a>
            <p className="mt-2 text-muted">
              {linkActive
                ? linkExpiresAt
                  ? ru.proposal.linkValidUntil(new Date(linkExpiresAt).toLocaleDateString("ru-RU"))
                  : null
                : ru.proposal.linkExpiredForDesigner}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => changeLink("extend")} disabled={linkPending} className="btn-ghost">
                {ru.proposal.extendLink}
              </button>
              {linkActive && (
                <button type="button" onClick={() => changeLink("revoke")} disabled={linkPending} className="btn-ghost">
                  {ru.proposal.revokeLink}
                </button>
              )}
            </div>
            {linkError && <p role="alert" className="mt-2 text-amber-800">{linkError}</p>}
          </>
        ) : (
          <span className="text-muted">
            Ссылка для клиента появится здесь после кнопки «{ru.proposal.send}» — до этого КП виден
            только вам.
          </span>
        )}
      </div>

      <div className="space-y-5">
        {sections.map((s) => (
          <div key={s.id} className="card">
            <h3 className="mb-2 font-semibold">{s.title}</h3>
            <textarea
              value={s.body}
              onChange={(e) => edit(s.id, e.target.value)}
              readOnly={sent}
              className="input min-h-32 font-sans leading-relaxed"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
