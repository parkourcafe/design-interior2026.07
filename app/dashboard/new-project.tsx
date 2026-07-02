"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProject } from "./actions";
import { ru } from "@/lib/i18n/ru";

export default function NewProject() {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createProject(name);
      if (res.ok && res.projectId) {
        router.push(`/dashboard/projects/${res.projectId}`);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="card flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <label className="label" htmlFor="client">
          {ru.projects.clientName}
        </label>
        <input
          id="client"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Иван Петров"
          className="input"
        />
      </div>
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? ru.projects.creating : ru.projects.create}
      </button>
    </form>
  );
}
