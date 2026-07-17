"use client";

// «Один бриф — весь пресейл»: sticky-сцена с паспортом проекта в центре.
// Прокрутка переключает пять сценариев: бриф → паспорт → риски → цена → КП.

import Image from "next/image";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import { MEDIA } from "./media";
import { StickyScene } from "./cinema";

const l = ru.landing.loop;
const HREFS = ["/demo/brief", "/demo", "/demo", "/demo", "/demo/proposal"];

export default function LoopScene() {
  const count = l.cases.length;
  return (
    <>
      {/* Мобайл: статичная версия — паспорт + все кейсы списком. */}
      <div className="landing px-5 py-16 md:hidden">
        <p className="mb-4 text-[12px] uppercase tracking-[0.24em] text-bronze">{l.eyebrow}</p>
        <h2 className="font-display mb-8 text-[30px] font-semibold leading-[1.08] text-ivory">{l.title}</h2>
        <div className="relative mx-auto mb-10 w-[min(78vw,320px)] overflow-hidden rounded-2xl border border-linedark">
          <Image
            src={MEDIA.passport}
            alt="Паспорт проекта ARHIDOM — стилизованная демонстрация"
            width={800}
            height={1000}
            sizes="78vw"
            className="h-auto w-full"
          />
        </div>
        <div className="space-y-7">
          {l.cases.map((c, i) => (
            <div key={c.k} className="border-l-2 border-bronze/40 pl-5">
              <span className="mb-1.5 inline-block rounded-full border border-bronze/40 bg-bronze/10 px-3 py-1 text-[11.5px] text-bronze">
                {c.k}
              </span>
              <h3 className="font-display text-[22px] font-semibold leading-tight text-ivory">{c.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ivory/65">{c.copy}</p>
              <Link href={HREFS[i] ?? "/demo"} className="mt-2.5 inline-flex items-center gap-2 text-[13.5px] text-bronze">
                {c.cta} <span aria-hidden>→</span>
              </Link>
            </div>
          ))}
        </div>
      </div>

      <StickyScene heightVh={110 * count} className="landing relative hidden md:block">
        {(p) => {
        const idx = Math.min(count - 1, Math.floor(p * count));
        const active = l.cases[idx] ?? l.cases[0]!;
        return (
          <div className="mx-auto w-full max-w-[1280px] px-5 md:px-8">
            <div className="grid items-center gap-10 md:grid-cols-[0.9fr_1.1fr] md:gap-16">
              {/* Паспорт — центральный объект */}
              <div className="relative mx-auto w-[min(72vw,320px)] md:w-full md:max-w-[400px]">
                <div
                  className="relative overflow-hidden rounded-2xl border border-linedark shadow-[0_48px_120px_-40px_rgba(0,0,0,0.85)]"
                  style={{
                    transform: `rotate(${((p - 0.5) * 4).toFixed(2)}deg) scale(${(0.96 + p * 0.06).toFixed(3)})`,
                  }}
                >
                  <Image
                    src={MEDIA.passport}
                    alt="Паспорт проекта ARHIDOM — стилизованная демонстрация"
                    width={800}
                    height={1000}
                    sizes="(max-width: 768px) 72vw, 400px"
                    className="h-auto w-full"
                    priority={false}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-coal/50 via-transparent to-transparent" />
                </div>
                {/* Индикатор кейсов */}
                <div className="mt-6 flex items-center justify-center gap-2" role="tablist" aria-label={l.title}>
                  {l.cases.map((c, i) => (
                    <span
                      key={c.k}
                      role="tab"
                      aria-selected={i === idx}
                      className={`h-1 rounded-full transition-all duration-500 ${
                        i === idx ? "w-10 bg-bronze" : "w-4 bg-linedark"
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Активный кейс */}
              <div>
                <p className="mb-4 text-[12px] uppercase tracking-[0.24em] text-bronze">{l.eyebrow}</p>
                <div className="mb-6 flex flex-wrap gap-2">
                  {l.cases.map((c, i) => (
                    <span
                      key={c.k}
                      className={`rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors duration-300 ${
                        i === idx
                          ? "border-bronze/60 bg-bronze/15 text-bronze"
                          : "border-linedark text-ivorymuted"
                      }`}
                    >
                      {c.k}
                    </span>
                  ))}
                </div>
                {/* key=idx перезапускает появление при смене кейса */}
                <div key={idx} className="animate-rise">
                  <h3 className="font-display max-w-[22ch] text-[clamp(26px,3.4vw,42px)] font-semibold leading-[1.08] text-ivory">
                    {active.title}
                  </h3>
                  <p className="mt-4 max-w-[52ch] text-[15.5px] leading-relaxed text-ivory/70">{active.copy}</p>
                  <Link
                    href={HREFS[idx] ?? "/demo"}
                    className="mt-6 inline-flex items-center gap-2 text-[14.5px] text-bronze underline-offset-4 hover:underline"
                  >
                    {active.cta} <span aria-hidden>→</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        );
      }}
      </StickyScene>
    </>
  );
}
