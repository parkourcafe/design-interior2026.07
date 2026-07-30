"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { createConceptPack } from "./actions";

export default function CreateConceptPackButton({
  projectId,
  className = "btn-primary",
}: {
  projectId: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const router = useRouter();

  function create() {
    setFailed(false);
    startTransition(async () => {
      const result = await createConceptPack(projectId);
      if (result.ok) {
        router.push(`/dashboard/projects/${projectId}/concept-pack`);
        router.refresh();
      } else {
        setFailed(true);
      }
    });
  }

  return (
    <div>
      <button type="button" onClick={create} disabled={pending} className={className}>
        {pending ? ru.conceptPack.creating : ru.conceptPack.create}
      </button>
      {failed && <p className="mt-2 text-sm text-red-700">{ru.conceptPack.createError}</p>}
    </div>
  );
}
