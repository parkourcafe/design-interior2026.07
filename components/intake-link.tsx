"use client";

import { useState } from "react";
import { ru } from "@/lib/i18n/ru";

export default function IntakeLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="card">
      <h3 className="font-medium">{ru.intakeLink.title}</h3>
      <p className="mt-1 text-sm text-muted">{ru.intakeLink.hint}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input readOnly value={url} className="input flex-1 font-mono text-xs" />
        <button onClick={copy} className="btn-ghost whitespace-nowrap">
          {copied ? ru.intakeLink.copied : ru.intakeLink.copy}
        </button>
      </div>
    </div>
  );
}
