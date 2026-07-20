import { pageMetadata } from "@/lib/seo";
import Image from "next/image";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import LandingNav from "@/components/landing/nav";
import LandingFooter from "@/components/landing/footer";
import { Cine } from "@/components/landing/cinema";
import { delay } from "@/components/landing/delay";
import { MEDIA } from "@/components/landing/media";

const d = ru.landing.demo;

export const metadata = pageMetadata({
  title: d.loopTitle,
  description: d.loopSub,
  path: "/demo",
});

// Иллюстрации к шагам контура (индексы соответствуют d.loopSteps).
const STEP_MEDIA: Record<number, { src: string; alt: string }> = {
  1: { src: MEDIA.clientBrief, alt: "Клиентский бриф — демонстрационный интерфейс" },
  2: { src: MEDIA.passport, alt: "Паспорт проекта — стилизованная демонстрация" },
  3: { src: MEDIA.risks, alt: "Карточки рисков вокруг плана — стилизованная демонстрация" },
  4: { src: MEDIA.agenda, alt: "Повестка первой встречи — демонстрационные карточки" },
  5: { src: MEDIA.pricing, alt: "Логика цены — демонстрационный интерфейс" },
  6: { src: MEDIA.proposal, alt: "КП собирается из блоков — стилизованная демонстрация" },
  7: { src: MEDIA.review, alt: "Review Board — демонстрационный интерфейс" },
};

export default function DemoLoopPage() {
  return (
    <div className="landing min-h-screen">
      <LandingNav />
      <main className="relative px-5 pb-24 pt-36 md:px-8">
        <div className="glow-amber pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-[880px]">
          <Cine className="mb-16 text-center">
            <span className="cine inline-block rounded-full border border-olive/40 bg-olive/10 px-3.5 py-1 text-[11px] uppercase tracking-[0.16em] text-olive">
              {d.badge}
            </span>
            <h1 className="cine font-display mt-5 text-[clamp(32px,5vw,56px)] font-semibold leading-[1.05] text-ivory" style={delay(1)}>
              {d.loopTitle}
            </h1>
            <p className="cine mx-auto mt-4 max-w-[56ch] text-[15.5px] leading-relaxed text-ivory/70" style={delay(2)}>
              {d.loopSub}
            </p>
          </Cine>

          {/* Вертикальная кинолента контура */}
          <div className="relative">
            <div aria-hidden className="absolute bottom-6 left-[19px] top-2 w-px bg-gradient-to-b from-bronze/60 via-linedark to-transparent md:left-1/2" />
            <div className="space-y-14">
              {d.loopSteps.map(([title, copy], i) => {
                const media = STEP_MEDIA[i];
                const left = i % 2 === 0;
                return (
                  <Cine key={title}>
                    <div className={`cine relative grid gap-5 pl-12 md:grid-cols-2 md:gap-12 md:pl-0`}>
                      <span
                        aria-hidden
                        className="absolute left-[11px] top-1 flex h-[17px] w-[17px] items-center justify-center rounded-full border border-bronze/60 bg-coal md:left-1/2 md:-translate-x-1/2"
                      >
                        <span className="h-[7px] w-[7px] rounded-full bg-bronze" />
                      </span>
                      <div className={`${left ? "md:order-1 md:pr-14 md:text-right" : "md:order-2 md:pl-14"}`}>
                        <div className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-bronze/80">
                          {String(i + 1).padStart(2, "0")}
                        </div>
                        <h2 className="font-display text-[24px] font-semibold leading-tight text-ivory">{title}</h2>
                        <p className="mt-2.5 text-[14px] leading-relaxed text-ivory/65">{copy}</p>
                      </div>
                      <div className={`${left ? "md:order-2 md:pl-14" : "md:order-1 md:pr-14"}`}>
                        {media && (
                          <div className="relative aspect-[16/10] overflow-hidden rounded-xl border border-linedark">
                            <Image
                              src={media.src}
                              alt={media.alt}
                              fill
                              sizes="(max-width: 768px) 100vw, 420px"
                              className="object-cover"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </Cine>
                );
              })}
            </div>
          </div>

          <Cine className="mt-20 text-center">
            <div className="cine flex flex-wrap items-center justify-center gap-3">
              <Link href="/demo/proposal" className="btn-bronze">
                {ru.landing.cta.c3} <span aria-hidden>→</span>
              </Link>
              <Link href="/login" className="btn-dark-ghost">
                {ru.landing.cta.c2}
              </Link>
            </div>
          </Cine>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
