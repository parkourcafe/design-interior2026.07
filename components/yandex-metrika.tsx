"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";

// Яндекс.Метрика для публичного лендинга (рынок РФ). Счётчик берётся из
// NEXT_PUBLIC_YM_ID; без него компонент не рендерит ничего — локальная
// разработка и превью остаются без трекинга. Маршруты клиента (бриф, КП)
// и кабинет не считаем: там ПДн, и это не маркетинговый трафик.
const QUIET_PREFIXES = ["/i/", "/p/", "/s/", "/c/", "/room", "/join", "/dashboard", "/app", "/projectceo", "/auth", "/login"];

declare global {
  interface Window {
    ym?: (id: number, action: string, ...args: unknown[]) => void;
  }
}

const YM_ID = Number(process.env.NEXT_PUBLIC_YM_ID ?? "");

export default function YandexMetrika() {
  const pathname = usePathname();
  const quiet = QUIET_PREFIXES.some((p) => pathname?.startsWith(p));

  // SPA-навигация: Метрика сама считает только первую загрузку.
  useEffect(() => {
    if (!YM_ID || quiet || typeof window.ym !== "function") return;
    window.ym(YM_ID, "hit", window.location.href);
  }, [pathname, quiet]);

  if (!YM_ID || quiet) return null;

  return (
    <Script id="yandex-metrika" strategy="afterInteractive">
      {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
ym(${YM_ID}, "init", { clickmap:true, trackLinks:true, accurateTrackBounce:true, webvisor:false });`}
    </Script>
  );
}
