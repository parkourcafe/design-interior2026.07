"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { CORRECTION_FIELDS, type CorrectionField } from "@/lib/project-room/passport-correction";
import { correctPassportField } from "./actions";

const t = ru.handoverPrep;

// «Исправить паспорт»: одно поле — одно сохранение (новая ревизия паспорта).
export default function PassportCorrections({
  projectId,
  fields,
}: {
  projectId: string;
  fields: readonly { readonly field: CorrectionField; readonly value: unknown }[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map(({ field, value }) => [field, value === null || value === undefined ? "" : String(value)])),
  );
  const [message, setMessage] = useState<{ field: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  function save(field: CorrectionField) {
    startTransition(async () => {
      const result = await correctPassportField(projectId, field, values[field]);
      setMessage({ field, ok: result.ok });
      if (result.ok) router.refresh();
    });
  }

  return (
    <details className="mt-4 rounded-md border border-line bg-white p-3" data-testid="passport-corrections">
      <summary className="cursor-pointer text-sm font-medium">{t.correctTitle}</summary>
      <p className="mt-2 text-xs text-muted">{t.correctHint}</p>
      <div className="mt-3 space-y-3">
        {fields.map(({ field }) => {
          const spec = CORRECTION_FIELDS[field];
          const id = `correct-${field.replace(".", "-")}`;
          return (
            <div key={field} className="flex flex-wrap items-end gap-2">
              <label htmlFor={id} className="w-40 text-sm">{t.fields[field] ?? field}</label>
              {spec.kind === "choice" ? (
                <select id={id} className="input max-w-xs" value={values[field]} onChange={(e) => setValues({ ...values, [field]: e.target.value })}>
                  {values[field] === "" ? <option value="">—</option> : null}
                  {spec.options.map((option) => <option key={option} value={option}>{t.options[option] ?? option}</option>)}
                </select>
              ) : spec.kind === "number" ? (
                <input id={id} className="input max-w-[8rem]" inputMode="decimal" value={values[field]} onChange={(e) => setValues({ ...values, [field]: e.target.value })} />
              ) : (
                <textarea id={id} className="input min-h-[2.5rem] flex-1" value={values[field]} onChange={(e) => setValues({ ...values, [field]: e.target.value })} />
              )}
              <button type="button" className="btn-ghost text-sm" disabled={pending} onClick={() => save(field)} data-field={field}>
                {t.correctSave}
              </button>
              {message?.field === field ? (
                <span role="status" className={`text-xs ${message.ok ? "text-muted" : "text-red-700"}`}>
                  {message.ok ? t.correctSaved : t.correctError}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </details>
  );
}
