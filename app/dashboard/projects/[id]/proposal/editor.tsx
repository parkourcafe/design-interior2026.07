"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProposalSection } from "@/lib/types";
import { saveProposal, sendProposal, rebuildProposal, approveProposal } from "./actions";
import { ru } from "@/lib/i18n/ru";

export default function ProposalEditor({
  projectId,
  initialSections,
  publicUrl,
  alreadySent,
  approved,
  selfApproved,
}: {
  projectId: string;
  initialSections: ProposalSection[];
  publicUrl: string;
  alreadySent: boolean;
  approved: boolean;
  selfApproved: boolean;
}) {
  const [sections, setSections] = useState(initialSections);
  const [saved, setSaved] = useState(false);
  const [sent, setSent] = useState(alreadySent);
  const [releaseApproved, setReleaseApproved] = useState(approved);
  const [authorApproved, setAuthorApproved] = useState(selfApproved);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function edit(id: string, body: string) {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, body } : s)));
    setSaved(false);
    setReleaseApproved(false);
    setAuthorApproved(false);
  }

  function save() {
    startTransition(async () => {
      const res = await saveProposal(projectId, sections);
      if (res.ok) setSaved(true);
    });
  }

  function send() {
    startTransition(async () => {
      const savedResult = await saveProposal(projectId, sections);
      if (!savedResult.ok) return;
      const res = await sendProposal(projectId);
      if (res.ok) {
        setSent(true);
        router.refresh();
      }
    });
  }

  function approve() {
    startTransition(async () => {
      const savedResult = await saveProposal(projectId, sections);
      if (!savedResult.ok) return;
      const res = await approveProposal(projectId);
      if (res.ok) {
        setReleaseApproved(true);
        setAuthorApproved(Boolean(res.selfApproved));
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
        setReleaseApproved(false);
        setAuthorApproved(false);
      } else if (res.reason === "sent") {
        window.alert("КП уже отправлено — пересборка недоступна.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center gap-3">
        {!sent && (
          <button onClick={save} disabled={pending} className="btn-ghost">
            {pending ? ru.proposal.saving : saved ? ru.proposal.saved : ru.proposal.save}
          </button>
        )}
        {!sent && (
          <button onClick={rebuild} disabled={pending} className="btn-ghost">
            Пересобрать
          </button>
        )}
        <button onClick={() => window.print()} className="btn-ghost">
          {ru.proposal.print}
        </button>
        {!sent && !releaseApproved && (
          <button onClick={approve} disabled={pending} className="btn-ghost">
            Подтвердить выпуск
          </button>
        )}
        <button onClick={send} disabled={pending || sent || !releaseApproved} className="btn-primary">
          {sent ? ru.proposal.sent : pending ? ru.proposal.sending : ru.proposal.send}
        </button>
      </div>

      {releaseApproved ? (
        <p className="no-print rounded-md border border-line bg-white p-3 text-sm text-muted">
          {authorApproved ? "Подтверждено автором действия" : "Выпуск подтверждён"}
        </p>
      ) : (
        <p className="no-print rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Выпуск КП заблокирован до подтверждения человеком.
        </p>
      )}

      <div className="no-print rounded-md border border-line bg-white p-3 text-sm">
        {sent ? (
          <>
            <span className="text-muted">{ru.proposal.publicLink}: </span>
            <a href={publicUrl} target="_blank" rel="noreferrer" className="break-all text-accent">
              {publicUrl}
            </a>
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
              disabled={sent}
              className="input min-h-32 font-sans leading-relaxed"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
