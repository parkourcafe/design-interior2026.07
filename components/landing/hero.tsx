"use client";

// Кинематографичный герой: полноэкранное видео (с постером-фолбэком),
// туман клиентских фраз и плавающие продуктовые карточки.
// Данные на карточках — демонстрационные (подпись в углу).

import Link from "next/link";
import { useEffect, useState } from "react";
import { ru } from "@/lib/i18n/ru";
import { MEDIA } from "./media";
import { useReducedMotion } from "./cinema";
import { delay } from "./delay";

const h = ru.landing.hero;

export default function Hero() {
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <section className="landing relative flex min-h-[100svh] flex-col justify-end overflow-hidden lg:justify-center">
      {/* Фон: постер всегда, видео поверх (reduced motion прячет видео CSS-ом). */}
      <div className="absolute inset-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={MEDIA.heroPoster}
          alt=""
          aria-hidden
          className="h-full w-full object-cover opacity-70"
        />
        {!reduced && (
          <video
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster={MEDIA.heroPoster}
            className="absolute inset-0 h-full w-full object-cover opacity-80"
          >
            <source src={MEDIA.heroVideo} type="video/mp4" />
          </video>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-coal/70 via-coal/40 to-coal" />
        <div className="grid-arch absolute inset-0 opacity-60" />
      </div>

      {/* Туманные фразы клиента (декор, скрыт от скринридеров). */}
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
        {h.fog.map((phrase, i) => (
          <span
            key={phrase}
            className="fog-phrase absolute font-display text-[19px] italic text-ivory/35"
            style={{
              ...delay(i, 1.6),
              top: `${[14, 24, 38, 18, 32][i]}%`,
              left: `${[8, 62, 12, 38, 74][i]}%`,
            }}
          >
            {phrase}
          </span>
        ))}
      </div>

      <div className="relative mx-auto grid w-full max-w-[1280px] items-center gap-12 px-5 pb-16 pt-36 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)] lg:pb-12 lg:pt-28">
        {/* Текст */}
        <div className={`${ready ? "is-in" : ""} lg:-translate-y-12`}>
          <p
            className="cine mb-5 w-fit border-l-2 border-bronze bg-gradient-to-r from-bronze/10 to-transparent py-1.5 pl-4 pr-8 text-[18px] font-medium tracking-[0.04em] text-ivory lg:translate-x-3"
            style={delay(0)}
          >
            {h.eyebrow}
          </p>
          <h1
            className="cine font-display max-w-[17ch] text-[clamp(62px,8.6vw,112px)] font-semibold leading-[0.88] tracking-[-0.035em] text-ivory"
            style={delay(1)}
          >
            {h.h1}
          </h1>
          <p
            className="cine mt-4 max-w-[22ch] font-display text-[clamp(26px,2.6vw,36px)] font-semibold leading-[1.1] text-ivory lg:ml-10"
            style={delay(2)}
          >
            {h.positioning}
          </p>
          <p className="cine mt-6 max-w-[52ch] text-[18px] leading-relaxed text-ivory/84 lg:ml-5" style={delay(3)}>
            {h.sub}
          </p>
          <p className="cine mt-6 max-w-[54ch] border-l border-bronze/45 pl-4 text-[16px] leading-relaxed text-ivory/80 lg:ml-5" style={delay(4)}>
            {h.boundary}
          </p>
          <div className="cine mt-8 lg:ml-5" style={delay(5)}>
            <Link href="/demo" className="btn-bronze">
              {h.cta1} <span aria-hidden>→</span>
            </Link>
            <p className="mt-6 text-[13px] uppercase tracking-[0.16em] text-ivorymuted">{h.roleLabel}</p>
            <div className="mt-3 grid max-w-[560px] grid-cols-2 gap-2.5">
              <Link
                href="/designers"
                className="group flex min-h-14 items-center justify-between gap-2 rounded-xl border border-linedark bg-coal2/75 px-4 py-3 text-[15px] font-medium text-ivory transition-colors hover:border-bronze/55 hover:bg-bronze/10"
              >
                <span>{h.cta2}</span>
                <span className="text-bronze transition-transform group-hover:translate-x-1" aria-hidden>→</span>
              </Link>
              <Link
                href="/studios"
                className="group flex min-h-14 items-center justify-between gap-2 rounded-xl border border-linedark bg-coal2/75 px-4 py-3 text-[15px] font-medium text-ivory transition-colors hover:border-bronze/55 hover:bg-bronze/10"
              >
                <span>{h.cta3}</span>
                <span className="text-bronze transition-transform group-hover:translate-x-1" aria-hidden>→</span>
              </Link>
            </div>
          </div>
          <p className="cine mt-6 text-[12.5px] tracking-wide text-ivorymuted lg:ml-5" style={delay(6)}>
            {h.trust}
          </p>
        </div>

        {/* Плавающие продуктовые карточки */}
        <div
          className={`relative hidden origin-center lg:block lg:translate-x-4 lg:translate-y-20 lg:scale-[0.7] xl:translate-x-10 ${
            ready ? "is-in" : ""
          }`}
          aria-hidden={false}
        >
          <div className="cine cine-scale float-slow glass-strong relative z-10 p-6" style={{ ...delay(5), "--r": "-0.6deg" } as React.CSSProperties}>
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[15px] font-semibold text-ivory">{h.card1.title}</span>
              <span className="rounded-full border border-olive/40 bg-olive/10 px-2.5 py-0.5 text-[10.5px] uppercase tracking-wider text-olive">
                demo
              </span>
            </div>
            <ul className="space-y-2">
              {h.card1.rows.map((row) => (
                <li key={row} className="flex items-center gap-2.5 text-[13.5px] text-ivory/80">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-olive/20 text-[10px] text-olive">✓</span>
                  {row}
                </li>
              ))}
            </ul>
            <div className="mt-4 border-t border-linedark pt-3.5">
              <div className="text-[10.5px] uppercase tracking-[0.16em] text-ivorymuted">{h.card1.nextLabel}</div>
              <div className="mt-1 text-[13.5px] text-ivory">{h.card1.next}</div>
            </div>
            <div className="btn-bronze mt-4 w-full !min-h-10 !text-[13px]">{h.card1.cta}</div>
          </div>

          <div
            className="cine cine-scale float-slow glass-strong absolute -left-16 -top-24 z-0 w-[290px] p-5"
            style={{ ...delay(7), "--r": "1.2deg", "--d": "0.63s" } as React.CSSProperties}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-bronze">{h.card2.tag}</span>
              <span className="rounded-full bg-bronze/15 px-2 py-0.5 text-[10px] text-bronze">{h.card2.confidence}</span>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-ivorymuted">{h.card2.evidenceLabel}</div>
            <p className="mb-2.5 mt-0.5 text-[13px] leading-snug text-ivory/85">{h.card2.evidence}</p>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-ivorymuted">{h.card2.impactLabel}</div>
            <p className="mt-0.5 text-[12.5px] leading-snug text-ivory/70">{h.card2.impact}</p>
            <div className="mt-3.5 flex gap-2 text-[12px]">
              <span className="flex-1 rounded-md bg-bronze/90 px-2 py-1.5 text-center font-medium text-coal">{h.card2.accept}</span>
              <span className="flex-1 rounded-md border border-linedark px-2 py-1.5 text-center text-ivory/70">{h.card2.reject}</span>
            </div>
          </div>

          <div
            className="cine cine-scale float-slow glass-strong absolute -bottom-10 -right-6 z-20 w-[270px] p-5"
            style={{ ...delay(9), "--r": "-1.4deg", "--d": "0.81s" } as React.CSSProperties}
          >
            <div className="mb-3 font-display text-[17px] text-ivory">{h.card3.title}</div>
            {[
              [h.card3.packageLabel, h.card3.package],
              [h.card3.priceLabel, h.card3.price],
              [h.card3.statusLabel, h.card3.status],
            ].map(([k, v]) => (
              <div key={k} className="border-b border-linedark py-2 last:border-0">
                <div className="text-[10px] uppercase tracking-[0.14em] text-ivorymuted">{k}</div>
                <div className="mt-0.5 text-[13px] text-ivory/85">{v}</div>
              </div>
            ))}
            <div className="mt-3 rounded-md border border-bronze/50 px-2 py-1.5 text-center text-[12.5px] text-bronze">
              {h.card3.cta}
            </div>
          </div>

          <p className="absolute -bottom-16 right-0 text-[11px] text-ivorymuted/60">{h.demoNote}</p>
        </div>
      </div>
    </section>
  );
}
