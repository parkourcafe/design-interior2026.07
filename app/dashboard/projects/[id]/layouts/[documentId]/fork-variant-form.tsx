"use client";

import { useState, useTransition } from "react";

import { ru } from "@/lib/i18n/ru";
import { WORKSPACE_VARIANT_ROLES } from "@/lib/layout-studio/application/workspace-binding";
import { forkLayout } from "../actions";

const copy = ru.layoutStudio.project.fork;
const roleNames = ru.layoutStudio.workspace.roleNames;

/**
 * «Создать вариант от этой планировки»: копия геометрии под другую роль —
 * экономичный или премиальный вариант той же комнаты.
 *
 * После успеха — полная навигация на редактор копии, не мягкий переход:
 * редактор держит сессию в состоянии компонента, и смена документа под тем же
 * деревом оставила бы кадр чужой планировки до перегидрации.
 */
export default function ForkVariantForm({
  projectId,
  documentId,
}: {
  readonly projectId: string;
  readonly documentId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<string>("value_engineered");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("role", role);
      const result = await forkLayout(projectId, documentId, formData);
      if ("error" in result) {
        setError(copy.failed);
        return;
      }
      window.location.assign(
        `/dashboard/projects/${projectId}/layouts/${encodeURIComponent(result.documentId)}`,
      );
    });
  };

  return (
    <span className="ml-auto flex items-center gap-2 text-sm">
      <label htmlFor="fork-role" className="text-neutral-600">
        {copy.label}
      </label>
      <select
        id="fork-role"
        value={role}
        onChange={(event) => setRole(event.target.value)}
        className="rounded border border-neutral-300 px-2 py-1"
      >
        {WORKSPACE_VARIANT_ROLES.map((value) => (
          <option key={value} value={value}>
            {roleNames[value] ?? value}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className="rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-50"
      >
        {pending ? copy.pending : copy.action}
      </button>
      {error && <span role="alert" className="text-red-700">{error}</span>}
    </span>
  );
}
