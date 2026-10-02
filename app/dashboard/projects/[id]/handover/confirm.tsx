"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import type { Reconciliation } from "@/lib/project-room/handover-state";
import { confirmHandover } from "./actions";
import { handOverToWork } from "../room/actions";

const t = ru.handoverPrep;

// Подтверждение сверки и передача. Передать можно только по действующей сверке.
export default function HandoverConfirm({
  projectId,
  proposalVersion,
  blockers,
  reconciliation,
}: {
  projectId: string;
  proposalVersion: number;
  blockers: readonly { readonly code: string; readonly detail: string }[];
  reconciliation: Reconciliation;
}) {
  const router = useRouter();
  const [attest, setAttest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirmed = reconciliation.state === "confirmed";

  return (
    <div className="mt-5 space-y-3" data-testid="handover-confirm">
      {reconciliation.state === "stale" ? (
        <div role="alert" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm">
          <p className="font-medium">{t.staleTitle}</p>
          <p>{t.stale(reconciliation.reason)}</p>
        </div>
      ) : null}
      {confirmed ? (
        <p className="text-sm" data-testid="reconciled">{t.confirmed(new Date(reconciliation.at).toLocaleString("ru-RU"), proposalVersion)}</p>
      ) : (
        <>
          {blockers.length > 0 ? (
            <div className="rounded-md border border-line bg-white p-3 text-sm" data-testid="handover-blockers">
              <p className="font-medium">{t.blockersTitle}</p>
              <ul className="mt-1 list-disc pl-5">
                {blockers.map((b) => <li key={b.code}>{t.blocker(b.code, b.detail)}</li>)}
              </ul>
            </div>
          ) : null}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} disabled={blockers.length > 0} />
            {t.attest}
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={pending || !attest || blockers.length > 0}
            onClick={() => startTransition(async () => {
              setError(null);
              const result = await confirmHandover(projectId);
              if (result.ok) router.refresh(); else setError(t.confirmError);
            })}
          >
            {pending ? t.confirming : t.confirm}
          </button>
        </>
      )}
      {confirmed ? (
        <button
          type="button"
          className="btn-primary"
          disabled={pending}
          onClick={() => startTransition(async () => {
            setError(null);
            const result = await handOverToWork(projectId);
            if (result.ok) router.push(`/dashboard/projects/${projectId}/room`);
            else { setError(ru.handover.error(result.reason ?? "")); router.refresh(); }
          })}
        >
          {pending ? t.handingOver : t.handover}
        </button>
      ) : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
