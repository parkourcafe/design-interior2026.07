"use client";

// Форма заявки на пилот. Отправка: фиксируем событие pilot_request, затем
// показываем готовый текст заявки — письмо в один клик или копирование.
// Так заявка гарантированно доходит без отдельной таблицы лидов в v0.1.

import { useMemo, useState } from "react";
import { ru } from "@/lib/i18n/ru";
import { supportEmail } from "@/lib/env";

const p = ru.landing.pagePilot;
const SUPPORT_EMAIL = supportEmail();

const FIELD_KEYS = [
  "name",
  "studio",
  "city",
  "role",
  "contact",
  "email",
  "teamSize",
  "leads",
  "briefNow",
  "proposalNow",
  "tools",
  "improve",
] as const;

type FieldKey = (typeof FIELD_KEYS)[number];
const TEXTAREA_KEYS: FieldKey[] = ["briefNow", "proposalNow", "improve"];
const REQUIRED_KEYS: FieldKey[] = ["name", "contact"];

export default function PilotForm() {
  const [values, setValues] = useState<Record<FieldKey, string>>(
    Object.fromEntries(FIELD_KEYS.map((k) => [k, ""])) as Record<FieldKey, string>,
  );
  const [interests, setInterests] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [copied, setCopied] = useState(false);

  const summary = useMemo(() => {
    const lines = FIELD_KEYS.filter((k) => values[k].trim()).map(
      (k) => `${p.fields[k]}: ${values[k].trim()}`,
    );
    if (interests.length) lines.push(`${p.interestsLabel}: ${interests.join(", ")}`);
    return `${p.formTitle}\n\n${lines.join("\n")}`;
  }, [values, interests]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    // Событие — best effort: даже если сеть упала, покажем экран с текстом.
    try {
      await fetch("/api/pilot", { method: "POST" });
    } catch {
      /* не блокируем пользователя */
    }
    setState("done");
  }

  if (state === "done") {
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(p.formTitle)}&body=${encodeURIComponent(summary)}`;
    return (
      <div className="glass-strong animate-rise p-8">
        <h3 className="font-display text-[26px] font-semibold text-ivory">{p.okTitle}</h3>
        <p className="mt-3 max-w-[58ch] text-[14px] leading-relaxed text-ivory/70">{p.okText}</p>
        <pre className="mt-5 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-linedark bg-coal/70 p-4 text-[12.5px] leading-relaxed text-ivory/80">
          {summary}
        </pre>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href={mailto} className="btn-bronze">
            {p.okMail}
          </a>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(summary);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                /* clipboard может быть недоступен */
              }
            }}
            className="btn-dark-ghost"
          >
            {copied ? p.okCopied : p.okCopy}
          </button>
        </div>
        <p className="mt-5 text-[13px] text-ivorymuted">
          {p.altCta}{" "}
          <a className="text-bronze underline-offset-4 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="glass-strong p-8">
      <h3 className="font-display text-[26px] font-semibold text-ivory">{p.formTitle}</h3>
      <p className="mt-2 text-[14px] text-ivory/65">{p.formSub}</p>

      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        {FIELD_KEYS.map((k) => {
          const isArea = TEXTAREA_KEYS.includes(k);
          const required = REQUIRED_KEYS.includes(k);
          const id = `pilot-${k}`;
          return (
            <div key={k} className={isArea ? "sm:col-span-2" : ""}>
              <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-medium text-ivory/80">
                {p.fields[k]}
                {required && <span className="text-bronze"> *</span>}
              </label>
              {isArea ? (
                <textarea
                  id={id}
                  value={values[k]}
                  onChange={(e) => setValues({ ...values, [k]: e.target.value })}
                  placeholder={k === "tools" ? p.fields.toolsPlaceholder : undefined}
                  className="min-h-[84px] w-full resize-y rounded-lg border border-linedark bg-coal/60 px-3.5 py-2.5 text-[14px] text-ivory outline-none placeholder:text-ivorymuted/50 focus:border-bronze"
                />
              ) : (
                <input
                  id={id}
                  type={k === "email" ? "email" : "text"}
                  required={required}
                  value={values[k]}
                  onChange={(e) => setValues({ ...values, [k]: e.target.value })}
                  placeholder={k === "role" ? p.fields.rolePlaceholder : k === "tools" ? p.fields.toolsPlaceholder : undefined}
                  className="w-full rounded-lg border border-linedark bg-coal/60 px-3.5 py-2.5 text-[14px] text-ivory outline-none placeholder:text-ivorymuted/50 focus:border-bronze"
                />
              )}
            </div>
          );
        })}
      </div>

      <fieldset className="mt-6">
        <legend className="mb-2.5 text-[12.5px] font-medium text-ivory/80">{p.interestsLabel}</legend>
        <div className="flex flex-wrap gap-2">
          {p.interests.map((it) => {
            const active = interests.includes(it);
            return (
              <button
                type="button"
                key={it}
                onClick={() =>
                  setInterests(active ? interests.filter((x) => x !== it) : [...interests, it])
                }
                aria-pressed={active}
                className={`rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors ${
                  active
                    ? "border-bronze/70 bg-bronze/15 text-bronze"
                    : "border-linedark text-ivorymuted hover:border-ivory/40 hover:text-ivory"
                }`}
              >
                {it}
              </button>
            );
          })}
        </div>
      </fieldset>

      <button type="submit" disabled={state === "sending"} className="btn-bronze mt-7 w-full sm:w-auto">
        {state === "sending" ? p.submitting : p.submit}
      </button>
    </form>
  );
}
