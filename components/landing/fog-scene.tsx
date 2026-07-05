"use client";

// «Клиентский туман»: sticky-сцена, где хаос пресейла (голосовые, скриншоты,
// старые шаблоны) по мере прокрутки рассыпается, а справа собирается структура.

import { ru } from "@/lib/i18n/ru";
import { StickyScene } from "./cinema";

const f = ru.landing.fog;

// Кусочная функция: 0 до start, 1 после end.
const seg = (p: number, start: number, end: number) =>
  Math.min(1, Math.max(0, (p - start) / (end - start)));

export default function FogScene() {
  return (
    <>
      {/* Мобайл: статичная версия (sticky-сцена не влезает в маленький экран). */}
      <div className="landing px-0 py-16 md:hidden">
        <Content p={1} />
      </div>
      <StickyScene heightVh={260} className="landing relative hidden md:block">
        {(p) => <Content p={p} />}
      </StickyScene>
    </>
  );
}

function Content({ p }: { p: number }) {
  return (
        <div className="glow-amber mx-auto w-full max-w-[1280px] px-5 md:px-8">
          <div className="mb-10 max-w-[720px]">
            <p className="mb-4 text-[12px] uppercase tracking-[0.24em] text-bronze">{f.eyebrow}</p>
            <h2 className="font-display text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.05] text-ivory">
              {f.title}
            </h2>
            <p
              className="mt-4 max-w-[58ch] text-[15.5px] leading-relaxed text-ivory/70"
              style={{ opacity: 0.4 + seg(p, 0, 0.25) * 0.6 }}
            >
              {f.copy}
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2 md:gap-14">
            {/* Хаос: рассыпается по мере прокрутки */}
            <div>
              <div className="mb-4 text-[11px] uppercase tracking-[0.2em] text-ivorymuted">{f.chaosLabel}</div>
              <div className="flex flex-wrap gap-2.5">
                {f.chaos.map((c, i) => {
                  const t = seg(p, 0.12 + i * 0.05, 0.4 + i * 0.05);
                  return (
                    <span
                      key={c}
                      className="rounded-lg border border-linedark bg-coal2/80 px-3.5 py-2 text-[13px] text-ivory/70"
                      style={{
                        opacity: 1 - t * 0.82,
                        filter: `blur(${(t * 3).toFixed(1)}px)`,
                        transform: `translate(${(t * (i % 2 ? 18 : -22)).toFixed(0)}px, ${(t * (i % 3 ? -14 : 12)).toFixed(0)}px) rotate(${(t * (i % 2 ? 3 : -3)).toFixed(1)}deg)`,
                      }}
                    >
                      {c}
                    </span>
                  );
                })}
              </div>
              {/* Микросцены-противоречия */}
              <div className="mt-8 hidden md:block">
                {f.scenes.map((s, i) => {
                  const t = seg(p, 0.3 + i * 0.09, 0.42 + i * 0.09);
                  return (
                    <p
                      key={s}
                      className="font-display py-1 text-[17px] italic leading-snug text-bronze/80"
                      style={{ opacity: t, transform: `translateY(${((1 - t) * 10).toFixed(0)}px)` }}
                    >
                      {s}
                    </p>
                  );
                })}
              </div>
            </div>

            {/* Структура: собирается */}
            <div>
              <div className="mb-4 text-[11px] uppercase tracking-[0.2em] text-olive">{f.orderLabel}</div>
              <div className="glass-strong divide-y divide-linedark px-6 py-2">
                {f.order.map(([k, v], i) => {
                  const t = seg(p, 0.18 + i * 0.07, 0.32 + i * 0.07);
                  return (
                    <div
                      key={k}
                      className="flex items-baseline justify-between gap-4 py-3"
                      style={{ opacity: t, transform: `translateX(${((1 - t) * 22).toFixed(0)}px)` }}
                    >
                      <span className="text-[14px] font-medium text-ivory">{k}</span>
                      <span className="text-right text-[12.5px] text-ivorymuted">{v}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
  );
}
