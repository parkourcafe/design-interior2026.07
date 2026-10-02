"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { createProposalRevision } from "./actions";

// «Подготовить версию N+1» после ответа клиента «обсудить» / «правки».
export default function CreateRevisionButton({ projectId, nextVersion }: { projectId: string; nextVersion: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  return (
    <div>
      <button
        className="btn-primary"
        disabled={pending}
        onClick={() => startTransition(async () => {
          setError(false);
          const result = await createProposalRevision(projectId);
          if (result.ok) router.refresh();
          else setError(true);
        })}
      >
        {pending ? ru.proposal.revisionCreating : ru.proposal.revisionCreate(nextVersion)}
      </button>
      {error ? <p role="alert" className="mt-2 text-sm text-red-700">{ru.proposal.revisionError}</p> : null}
    </div>
  );
}
