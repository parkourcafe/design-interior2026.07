"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProposalSection } from "@/lib/types";
import { saveProposal, sendProposal } from "./actions";
import { ru } from "@/lib/i18n/ru";

export default function ProposalEditor({
  projectId,
  initialSections,
  publicUrl,
  alreadySent,
}: {
  projectId: string;
  initialSections: ProposalSection[];
  publicUrl: string;
  alreadySent: boolean;
}) {
  const [sections, setSections] = useState(initialSections);
  const [saved, setSaved] = useState(false);
  const [sent, setSent] = useState(alreadySent);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function edit(id: string, body: string) {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, body } : s)));
    setSaved(false);
  }

  function save() {
    startTransition(async () => {
      const res = await saveProposal(projectId, sections);
      if (res.ok) setSaved(true);
    });
  }

  function send() {
    startTransition(async () => {
      await saveProposal(projectId, sections);
      const res = await sendProposal(projectId);
      if (res.ok) {
        setSent(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center gap-3">
        <button onClick={save} disabled={pending} className="btn-ghost">
          {pending ? ru.proposal.saving : saved ? ru.proposal.saved : ru.proposal.save}
        </button>
        <button onClick={() => window.print()} className="btn-ghost">
          {ru.proposal.print}
        </button>
        <button onClick={send} disabled={pending || sent} className="btn-primary">
          {sent ? ru.proposal.sent : pending ? ru.proposal.sending : ru.proposal.send}
        </button>
      </div>

      <div className="no-print rounded-md border border-line bg-white p-3 text-sm">
        <span className="text-muted">{ru.proposal.publicLink}: </span>
        <a href={publicUrl} target="_blank" rel="noreferrer" className="break-all text-accent">
          {publicUrl}
        </a>
      </div>

      <div className="space-y-5">
        {sections.map((s) => (
          <div key={s.id} className="card">
            <h3 className="mb-2 font-semibold">{s.title}</h3>
            <textarea
              value={s.body}
              onChange={(e) => edit(s.id, e.target.value)}
              className="input min-h-32 font-sans leading-relaxed"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
