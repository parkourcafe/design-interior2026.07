"use client";

// Демо-блок «Ваше решение» на demo-КП: показывает CTA принять/обсудить/правки.
// Ничего не отправляет — это витрина реального потока с /p/[token].

import { useState } from "react";
import { ru } from "@/lib/i18n/ru";

const r = ru.landing.demoProposal.respond;

export default function RespondDemo() {
  const [choice, setChoice] = useState<null | "accept" | "discuss" | "changes">(null);

  const msg =
    choice === "accept" ? r.acceptedMsg : choice === "discuss" ? r.discussMsg : choice === "changes" ? r.changesMsg : null;

  return (
    <div className="rounded-xl border border-line bg-[#f6f5f0] p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="font-display text-[20px] font-semibold text-ink">{r.title}</span>
        <span className="rounded-full border border-clientaccent/30 bg-clientaccent/10 px-2.5 py-0.5 text-[10.5px] uppercase tracking-[0.14em] text-clientaccent">
          {ru.landing.demo.badge}
        </span>
      </div>
      {!msg ? (
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <button onClick={() => setChoice("accept")} className="btn-primary flex-1">
            {r.accept}
          </button>
          <button onClick={() => setChoice("discuss")} className="btn-ghost flex-1">
            {r.discuss}
          </button>
          <button onClick={() => setChoice("changes")} className="btn-ghost flex-1">
            {r.changes}
          </button>
        </div>
      ) : (
        <div className="animate-rise rounded-lg border border-line bg-white px-4 py-3.5 text-[14px] leading-relaxed text-ink/85">
          {msg}
          <button onClick={() => setChoice(null)} className="ml-2 text-clientaccent underline underline-offset-2">
            ←
          </button>
        </div>
      )}
      <p className="mt-3 text-[12px] text-muted">{r.demoNote}</p>
    </div>
  );
}
