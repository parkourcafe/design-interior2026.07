"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { createProjectRoom } from "./actions";

export default function CreateRoomButton({ projectId }: { projectId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const router = useRouter();
  return <div><button className="btn-primary" disabled={pending} onClick={async () => {
    setPending(true); setError(false);
    const result = await createProjectRoom(projectId);
    if (result.ok) router.push(`/dashboard/projects/${projectId}/room`); else setError(true);
    setPending(false);
  }}>{pending ? ru.projectRoom.creating : ru.projectRoom.create}</button>{error && <p className="mt-2 text-sm text-red-600">{ru.projectRoom.createError}</p>}</div>;
}
