"use client";

import { useState } from "react";
import { ru } from "@/lib/i18n/ru";

// Блок с публичной ссылкой-брифом, которую клиент рассылает дизайнерам.
export default function ShareBrief({ url }: { url: string }) {
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
    <div className="mx-auto mt-6 w-full max-w-md text-left">
      <div className="card">
        <input readOnly value={url} className="input font-mono text-xs" />
        <div className="mt-3 flex gap-2">
          <button onClick={copy} className="btn-primary flex-1">
            {copied ? ru.client.copied : ru.client.copy}
          </button>
          <a href={url} target="_blank" rel="noreferrer" className="btn-ghost">
            {ru.client.openBrief}
          </a>
        </div>
      </div>
    </div>
  );
}
