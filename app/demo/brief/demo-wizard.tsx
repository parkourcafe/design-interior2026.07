"use client";

// Демо-бриф «глазами клиента»: настоящие вопросы из lib/brief/questions.ts
// (источник истины), но всё локально — ответы НЕ отправляются и НЕ сохраняются.
// Реальному дизайнеру ничего не уходит; финал предлагает создать настоящий бриф.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import { QUESTIONS, type Question } from "@/lib/brief/questions";
import StartClientBrief from "@/app/start-client-brief";

const d = ru.landing.demo;
const b = ru.brief;

// Репрезентативный срез реального брифа: простые типы (choice/multi/text),
// чтобы демо честно показывало тон вопросов без сложных виджетов.
const DEMO_IDS = [
  "vision",
  "condition",
  "asset_horizon",
  "household",
  "decision_makers",
  "morning",
  "bath_count",
] as const;

export default function DemoWizard() {
  const questions = useMemo(
    () =>
      DEMO_IDS.map((id) => QUESTIONS.find((q) => q.id === id)).filter(
        (q): q is Question => Boolean(q),
      ),
    [],
  );
  const [screen, setScreen] = useState<"intro" | "steps" | "done">("intro");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [touchedNext, setTouchedNext] = useState(false);

  const q = questions[step];
  const value = q ? answers[q.id] : undefined;
  const answered =
    q?.type === "multi"
      ? Array.isArray(value) && value.length > 0
      : typeof value === "string" && value.trim().length > 0;

  function next() {
    if (!q) return;
    if (!answered && !q.optional && q.type !== "text") {
      setTouchedNext(true);
      return;
    }
    setTouchedNext(false);
    if (step + 1 >= questions.length) setScreen("done");
    else setStep(step + 1);
  }

  return (
    <div className="mx-auto w-full max-w-[640px]">
      {/* Шапка студии: клиент видит бренд, не технический email. */}
      <div className="mb-5 flex items-center justify-between rounded-xl border border-linedark bg-coal2/80 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-bronze/20 font-display text-[16px] text-bronze" aria-hidden>
            Д
          </span>
          <span className="text-[13.5px] text-ivory/85">{d.briefStudio}</span>
        </div>
        <span className="rounded-full border border-olive/40 bg-olive/10 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-olive">
          {d.badge}
        </span>
      </div>

      <div className="rounded-2xl border border-line bg-paper p-7 text-ink shadow-[0_48px_120px_-48px_rgba(0,0,0,0.9)] sm:p-9">
        {screen === "intro" && (
          <div className="animate-rise">
            <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted">{b.intro.eyebrow}</p>
            <h1 className="font-display text-[clamp(26px,4vw,34px)] font-semibold leading-[1.12]">
              {d.briefTitle}
            </h1>
            <p className="mt-4 text-[14.5px] leading-relaxed text-muted">{d.briefSub}</p>
            <button onClick={() => setScreen("steps")} className="btn-primary mt-7 px-6 py-3 text-[15px]">
              {d.briefStart} <span aria-hidden className="ml-1.5">→</span>
            </button>
          </div>
        )}

        {screen === "steps" && q && (
          <div key={q.id} className="animate-rise">
            {/* Прогресс */}
            <div className="mb-7 flex items-center gap-1.5" aria-label={`Вопрос ${step + 1} из ${questions.length}`}>
              {questions.map((_, i) => (
                <div key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-clientaccent" : "bg-line"}`} />
              ))}
            </div>
            <h2 className="font-display text-[clamp(22px,3.4vw,30px)] font-semibold leading-[1.16]">{q.title}</h2>
            {q.help && <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted">{q.help}</p>}

            <div className="mt-6 space-y-2.5">
              {q.type === "text" && (
                <textarea
                  className="input min-h-[130px] resize-y"
                  placeholder={q.placeholder}
                  value={typeof value === "string" ? value : ""}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                />
              )}
              {(q.type === "choice" || q.type === "multi") &&
                q.options?.map((o) => {
                  const active =
                    q.type === "multi"
                      ? Array.isArray(value) && value.includes(o.value)
                      : value === o.value;
                  return (
                    <button
                      key={o.value}
                      onClick={() => {
                        if (q.type === "multi") {
                          const cur = Array.isArray(value) ? value : [];
                          setAnswers({
                            ...answers,
                            [q.id]: cur.includes(o.value)
                              ? cur.filter((v) => v !== o.value)
                              : [...cur, o.value],
                          });
                        } else {
                          setAnswers({ ...answers, [q.id]: o.value });
                        }
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-[14.5px] transition-colors ${
                        active
                          ? "border-clientaccent bg-clientaccent/10 text-ink"
                          : "border-line bg-white text-ink hover:border-clientaccent/50"
                      }`}
                      aria-pressed={active}
                    >
                      <span
                        aria-hidden
                        className={`h-4 w-4 shrink-0 border ${q.type === "multi" ? "rounded" : "rounded-full"} ${
                          active ? "border-clientaccent bg-clientaccent" : "border-line"
                        }`}
                      />
                      {o.label}
                    </button>
                  );
                })}
            </div>

            {touchedNext && !answered && q.type !== "text" && (
              <p className="mt-3 text-[13px] text-red-600">{b.required}</p>
            )}

            <div className="mt-7 flex items-center justify-between">
              <button
                onClick={() => (step === 0 ? setScreen("intro") : setStep(step - 1))}
                className="btn-ghost px-5"
              >
                {b.back}
              </button>
              <button onClick={next} className="btn-primary px-6">
                {step + 1 >= questions.length ? b.finish : b.next}
              </button>
            </div>
          </div>
        )}

        {screen === "done" && (
          <div className="animate-rise">
            <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted">{d.badge}</p>
            <h2 className="font-display text-[clamp(24px,3.6vw,32px)] font-semibold leading-[1.12]">
              {b.done.title}
            </h2>
            <p className="mt-3 text-[14.5px] leading-relaxed text-muted">{b.done.subtitle}</p>
            <div className="mt-5 rounded-lg border border-line bg-white px-4 py-3.5 text-[13px] leading-relaxed text-muted">
              {d.briefDone} {b.privacy}
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <StartClientBrief label={d.briefRealCta} variant="cli" />
              <button
                onClick={() => {
                  setAnswers({});
                  setStep(0);
                  setScreen("intro");
                }}
                className="btn-ghost px-5"
              >
                {d.briefRestart}
              </button>
            </div>
            <p className="mt-6 text-[13.5px] text-muted">
              <Link href="/demo" className="text-clientaccent underline-offset-4 hover:underline">
                {d.briefNext} <span aria-hidden>→</span>
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
