"use client";

import { useState } from "react";
import { ru } from "@/lib/i18n/ru";

// Кнопка «скопировать» произвольный текст (напр. вопросы к встрече).
export default function CopyTextButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <button onClick={copy} className="btn-ghost text-xs">
      {copied ? ru.common.copied : label}
    </button>
  );
}
