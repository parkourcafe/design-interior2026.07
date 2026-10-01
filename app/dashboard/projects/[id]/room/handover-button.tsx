"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { handOverToWork } from "./actions";

const h = ru.handover;

export interface HandoverPreviewFile {
  readonly kind: string;
  readonly name: string;
  readonly size: number | null;
}

// «Передать в работу»: сначала показать, что уйдёт исполнителю, потом подтвердить.
export default function HandoverButton({
  projectId,
  proposalVersion,
  files,
}: {
  projectId: string;
  proposalVersion: number;
  files: readonly HandoverPreviewFile[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return <button className="btn-primary" onClick={() => setOpen(true)}>{h.open}</button>;
  }
  return (
    <div className="rounded-md border border-line bg-white p-4">
      <p className="text-sm font-medium">{h.willSend}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        <li>{h.proposalEntry(proposalVersion)}</li>
        <li>{h.passportEntry}</li>
        <li>{h.tasksEntry}</li>
        {files.map((file) => (
          <li key={`${file.kind}:${file.name}`}>
            {h.fileKind[file.kind] ?? file.kind}: {file.name}
            {file.size ? ` · ${Math.max(1, Math.round(file.size / 1024))} КБ` : ""}
          </li>
        ))}
      </ul>
      {files.length === 0 ? <p className="mt-2 text-xs text-muted">{h.noFiles}</p> : null}
      <p className="mt-2 text-xs text-muted">{h.notIncluded}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="btn-primary"
          disabled={pending}
          onClick={() => startTransition(async () => {
            setError(null);
            const result = await handOverToWork(projectId);
            if (result.ok) router.push(`/dashboard/projects/${projectId}/room`);
            else setError(h.error(result.reason ?? ""));
          })}
        >
          {pending ? h.sending : h.confirm}
        </button>
        <button className="btn-ghost" disabled={pending} onClick={() => setOpen(false)}>{h.cancel}</button>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
