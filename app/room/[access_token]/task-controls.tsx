"use client";
import { useState } from "react";
import { ru } from "@/lib/i18n/ru";
import type { TaskStatus } from "@/lib/project-room/types";

export default function PublicTaskControls({ token, taskId, value }: { token: string; taskId: string; value: TaskStatus }) {
  const [status, setStatus] = useState(value);
  return <select className="input mt-3 max-w-52" value={status} onChange={async (event) => { const previous = status; const next = event.target.value as TaskStatus; setStatus(next); const response = await fetch("/api/project-room/task-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, taskId, status: next }) }); if (!response.ok) setStatus(previous); }}>{Object.entries(ru.projectRoom.status).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>;
}
