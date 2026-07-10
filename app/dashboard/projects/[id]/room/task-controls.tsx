"use client";

import { useState } from "react";
import { ru } from "@/lib/i18n/ru";
import type { TaskStatus } from "@/lib/project-room/types";
import { updateDesignerTask } from "./actions";

export default function TaskControls({ projectId, taskId, value }: { projectId: string; taskId: string; value: TaskStatus }) {
  const [status, setStatus] = useState(value);
  return <select className="input max-w-48" value={status} onChange={async (event) => {
    const next = event.target.value as TaskStatus; setStatus(next);
    const result = await updateDesignerTask(projectId, taskId, next); if (!result.ok) setStatus(status);
  }}>{Object.entries(ru.projectRoom.status).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>;
}
