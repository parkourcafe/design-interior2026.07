"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ru } from "@/lib/i18n/ru";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Маршруты, где клиент проходит бриф / читает КП / смотрит демо: предложение
// «установить приложение» здесь ломает первый клиентский опыт — не показываем.
const QUIET_PREFIXES = ["/i/", "/b/", "/p/", "/demo"];

// Регистрирует service worker и показывает кнопку «Установить приложение»,
// когда браузер к этому готов (beforeinstallprompt).
export default function Pwa() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);
  const pathname = usePathname();
  const quiet = QUIET_PREFIXES.some((p) => pathname?.startsWith(p));

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

  if (!deferred || hidden || quiet) return null;

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => {});
    setDeferred(null);
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-xl border border-line bg-white px-4 py-3 shadow-lg">
      <span className="text-sm">{ru.pwa.install}</span>
      <button onClick={install} className="btn-primary px-3 py-1.5 text-xs">
        {ru.pwa.installCta}
      </button>
      <button onClick={() => setHidden(true)} className="text-muted hover:text-ink" aria-label="Закрыть">
        ✕
      </button>
    </div>
  );
}
