"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCardStatus, updateRiskCard, rerunRisks } from "./actions";
import type { RiskCardRow } from "@/lib/review";
import { ru } from "@/lib/i18n/ru";

const r = ru.review;

interface RiskEditDraft {
  evidence: string;
  impact: string;
  designer_action: string;
  proposal_implication: string;
}

function draftFromCard(card: RiskCardRow): RiskEditDraft {
  return {
    evidence: card.evidence.join("\n"),
    impact: card.impact,
    designer_action: card.designer_action,
    proposal_implication: card.proposal_implication,
  };
}

function draftToCard(draft: RiskEditDraft) {
  return {
    evidence: draft.evidence
      .split("\n")
      .map((e) => e.trim())
      .filter(Boolean),
    impact: draft.impact,
    designer_action: draft.designer_action,
    proposal_implication: draft.proposal_implication,
  };
}

export default function ReviewCards({
  projectId,
  cards,
}: {
  projectId: string;
  cards: RiskCardRow[];
}) {
  const [local, setLocal] = useState(cards);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RiskEditDraft>>({});
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function update(id: string, status: RiskCardRow["status"]) {
    setLocal((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
    startTransition(async () => {
      await setCardStatus(id, status);
      router.refresh();
    });
  }

  function rerun() {
    startTransition(async () => {
      await rerunRisks(projectId);
      router.refresh();
    });
  }

  function startEdit(card: RiskCardRow) {
    setEditingId(card.id);
    setDrafts((prev) => ({ ...prev, [card.id]: prev[card.id] ?? draftFromCard(card) }));
  }

  function cancelEdit(cardId: string) {
    setEditingId(null);
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[cardId];
      return next;
    });
  }

  function setDraftField(cardId: string, field: keyof RiskEditDraft, value: string) {
    setDrafts((prev) => {
      const current = prev[cardId] ?? {
        evidence: "",
        impact: "",
        designer_action: "",
        proposal_implication: "",
      };
      return { ...prev, [cardId]: { ...current, [field]: value } };
    });
  }

  function saveEdit(card: RiskCardRow) {
    const draft = drafts[card.id] ?? draftFromCard(card);
    const payload = draftToCard(draft);
    setLocal((prev) => prev.map((c) => (c.id === card.id ? { ...c, ...payload } : c)));
    startTransition(async () => {
      const res = await updateRiskCard(projectId, card.id, payload);
      if (res.ok) {
        setEditingId(null);
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[card.id];
          return next;
        });
      }
      router.refresh();
    });
  }

  if (local.length === 0) {
    return (
      <div>
        <p className="text-muted">Карточек рисков нет.</p>
        <button onClick={rerun} disabled={pending} className="btn-ghost mt-3">
          {r.llmRerun}
        </button>
      </div>
    );
  }

  // Группировка по категориям — быстрее принимать решения (деньги/сроки/…).
  const ORDER: RiskCardRow["risk_type"][] = ["budget", "timeline", "technical", "function", "style"];
  const groups = ORDER.map((type) => ({ type, cards: local.filter((c) => c.risk_type === type) })).filter(
    (g) => g.cards.length > 0,
  );

  function card(c: RiskCardRow) {
    const editing = editingId === c.id;
    const draft = drafts[c.id] ?? draftFromCard(c);
    return (
      <div key={c.id} className="card">
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs text-muted">
            {r.riskFields.confidence}: {r.confidence[c.confidence]} · {r.source[c.source]}
          </span>
          <StatusBadge status={c.status} />
        </div>

        <p className="mt-2 text-sm">
          <span className="text-muted">Возможный риск. </span>
          {c.impact}
        </p>

        {editing ? (
          <div className="mt-3 space-y-3 text-sm">
            <EditField
              label={r.riskFields.evidence}
              value={draft.evidence}
              rows={3}
              onChange={(v) => setDraftField(c.id, "evidence", v)}
            />
            <EditField
              label={r.riskFields.impact}
              value={draft.impact}
              rows={2}
              onChange={(v) => setDraftField(c.id, "impact", v)}
            />
            <EditField
              label={r.riskFields.designer_action}
              value={draft.designer_action}
              rows={2}
              onChange={(v) => setDraftField(c.id, "designer_action", v)}
            />
            <EditField
              label={r.riskFields.proposal_implication}
              value={draft.proposal_implication}
              rows={2}
              onChange={(v) => setDraftField(c.id, "proposal_implication", v)}
            />
          </div>
        ) : (
          <dl className="mt-3 space-y-2 text-sm">
            <Field label={r.riskFields.evidence}>
              <ul className="list-disc pl-5 text-muted">
                {c.evidence.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </Field>
            <Field label={r.riskFields.designer_action}>{c.designer_action}</Field>
            <Field label={r.riskFields.proposal_implication}>{c.proposal_implication}</Field>
          </dl>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => update(c.id, "accepted")}
            disabled={pending}
            className={`btn ${c.status === "accepted" ? "bg-accent text-white" : "btn-ghost"}`}
          >
            {r.accept}
          </button>
          <button
            onClick={() => update(c.id, "rejected")}
            disabled={pending}
            className={`btn ${c.status === "rejected" ? "bg-ink text-white" : "btn-ghost"}`}
          >
            {r.reject}
          </button>
          {editing ? (
            <>
              <button onClick={() => saveEdit(c)} disabled={pending} className="btn-primary">
                {r.saveCard}
              </button>
              <button onClick={() => cancelEdit(c.id)} disabled={pending} className="btn-ghost">
                {r.cancelEdit}
              </button>
            </>
          ) : (
            <button onClick={() => startEdit(c)} disabled={pending} className="btn-ghost">
              {r.editCard}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.type} className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">
              {r.riskType[g.type]}
            </span>
            <span className="text-xs text-muted">{g.cards.length}</span>
          </div>
          {g.cards.map(card)}
        </div>
      ))}

      <button onClick={rerun} disabled={pending} className="btn-ghost">
        {r.llmRerun}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function EditField({
  label,
  value,
  rows,
  onChange,
}: {
  label: string;
  value: string;
  rows: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="input mt-1 min-h-0 text-sm leading-relaxed"
      />
    </label>
  );
}

function StatusBadge({ status }: { status: RiskCardRow["status"] }) {
  if (status === "accepted")
    return <span className="text-xs font-medium text-accent">{ru.review.accepted}</span>;
  if (status === "rejected")
    return <span className="text-xs font-medium text-muted">{ru.review.rejected}</span>;
  return null;
}
