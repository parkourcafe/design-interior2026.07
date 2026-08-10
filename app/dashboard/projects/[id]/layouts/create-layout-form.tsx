"use client";

import { useState, useTransition } from "react";

import { ru } from "@/lib/i18n/ru";
import { createLayout } from "./actions";

const copy = ru.layoutStudio.project.create;

/**
 * Форма новой планировки.
 *
 * Метры, а не миллиметры: дизайнер думает о помещении в метрах. Перевод в
 * канонические миллиметры делает серверное действие — ровно в одном месте,
 * иначе округление разъехалось бы между формой и базой.
 */
export default function CreateLayoutForm({ projectId }: { readonly projectId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-6 rounded border border-neutral-200 p-4"
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          // При успехе действие делает redirect и сюда не возвращается.
          const result = await createLayout(projectId, formData);
          if (result?.error === "storage") setError(copy.errors.storage);
          else if (result?.error) setError(copy.errors.invalid);
        });
      }}
    >
      <h2 className="font-medium">{copy.title}</h2>
      <p className="mt-1 text-sm text-neutral-600">{copy.hint}</p>

      <label className="mt-4 block text-sm">
        {copy.nameLabel}
        <input
          name="name"
          required
          placeholder={copy.namePlaceholder}
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
        />
      </label>

      <div className="mt-3 grid grid-cols-3 gap-3">
        {[
          { name: "widthM", label: copy.widthLabel, fallback: "6" },
          { name: "depthM", label: copy.depthLabel, fallback: "4" },
          { name: "heightM", label: copy.heightLabel, fallback: "2.8" },
        ].map((field) => (
          <label key={field.name} className="block text-sm">
            {field.label}
            <input
              name={field.name}
              required
              type="number"
              step="0.01"
              min="0.5"
              defaultValue={field.fallback}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
            />
          </label>
        ))}
      </div>

      <p className="mt-3 text-xs text-neutral-500">{copy.surveyNote}</p>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}

      <button type="submit" disabled={pending} className="btn-primary mt-4 inline-flex">
        {copy.submit}
      </button>
    </form>
  );
}
