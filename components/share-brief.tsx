"use client";

import { useState } from "react";
import { ru } from "@/lib/i18n/ru";

// Блок с публичной ссылкой-брифом. Основное действие — «Отправить» через
// системное меню (navigator.share): клиент сразу шлёт ссылку в WhatsApp/почту/
// Telegram. Где share недоступен (десктоп) — фолбэк на копирование.
export default function ShareBrief({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: ru.briefShare.title, url });
        return;
      } catch {
        /* пользователь отменил — попробуем копирование */
      }
    }
    await copy();
  }

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
          <button onClick={share} className="btn-primary flex-1">
            {ru.client.send}
          </button>
          <button onClick={copy} className="btn-ghost">
            {copied ? ru.client.copied : ru.client.copy}
          </button>
        </div>
      </div>
    </div>
  );
}
