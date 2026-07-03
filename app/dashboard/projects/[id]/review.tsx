"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCardStatus, rerunRisks } from "./actions";
import type { RiskCardRow } from "@/lib/review";
import { ru } from "@/lib/i18n/ru";

const r = ru.review;

export default function ReviewCards({
  projectId,
  cards,
}: {
  projectId: string;
  cards: RiskCardRow[];
}) {
  const [local, setLocal] = useState(cards);
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

        <div className="mt-4 flex gap-2">
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

function StatusBadge({ status }: { status: RiskCardRow["status"] }) {
  if (status === "accepted")
    return <span className="text-xs font-medium text-accent">{ru.review.accepted}</span>;
  if (status === "rejected")
    return <span className="text-xs font-medium text-muted">{ru.review.rejected}</span>;
  return null;
}
