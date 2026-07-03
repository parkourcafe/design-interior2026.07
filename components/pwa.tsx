"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Регистрирует service worker и показывает кнопку «Установить приложение»,
// когда браузер к этому готов (beforeinstallprompt).
export default function Pwa() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!deferred || hidden) return null;

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => {});
    setDeferred(null);
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-xl border border-line bg-white px-4 py-3 shadow-lg">
      <span className="text-sm">Установить «Свод» на устройство?</span>
      <button onClick={install} className="btn-primary px-3 py-1.5 text-xs">
        Установить
      </button>
      <button onClick={() => setHidden(true)} className="text-muted hover:text-ink" aria-label="Закрыть">
        ✕
      </button>
    </div>
  );
}
