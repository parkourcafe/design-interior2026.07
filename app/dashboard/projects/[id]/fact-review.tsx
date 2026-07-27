"use client";

import { useTransition } from "react";
import { reviewProjectFact, retryWorkflow } from "./actions";

export interface FactView {
  id: string;
  fact_type: string;
  value: unknown;
  evidence_locator: string;
  status: string;
  version: number;
}

export default function FactReview({
  facts,
  workflow,
}: {
  facts: FactView[];
  workflow: { id: string; status: string; current_step: string } | null;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-2xl font-semibold">Процесс и факты</h2>
          <p className="text-sm text-muted">
            {workflow ? `${workflow.status} · ${workflow.current_step}` : "Процесс ещё не создан"}
          </p>
        </div>
        {workflow?.status === "failed" && (
          <button className="btn-ghost" disabled={pending} onClick={() => startTransition(async () => { await retryWorkflow(workflow.id); })}>
            Повторить шаг
          </button>
        )}
      </div>
      <div className="space-y-3">
        {facts.map((fact) => (
          <div key={fact.id} className="rounded-lg border border-line p-3">
            <p className="text-xs text-muted">{fact.fact_type} · {fact.evidence_locator} · v{fact.version}</p>
            <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm">{JSON.stringify(fact.value, null, 2)}</pre>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-muted">{fact.status}</span>
              {!["human_confirmed", "rejected"].includes(fact.status) && (
                <>
                  <button className="btn-ghost" disabled={pending} onClick={() => startTransition(async () => { await reviewProjectFact(fact.id, "human_confirmed"); })}>
                    Подтвердить
                  </button>
                  <button className="btn-ghost" disabled={pending} onClick={() => startTransition(async () => { await reviewProjectFact(fact.id, "rejected"); })}>
                    Отклонить
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
