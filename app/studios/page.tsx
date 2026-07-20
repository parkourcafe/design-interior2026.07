import { pageMetadata } from "@/lib/seo";
import Image from "next/image";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import LandingNav from "@/components/landing/nav";
import LandingFooter from "@/components/landing/footer";
import { Cine, Parallax } from "@/components/landing/cinema";
import { delay } from "@/components/landing/delay";
import { MEDIA } from "@/components/landing/media";

const p = ru.landing.pageStudios;
const L = ru.landing;

export const metadata = pageMetadata({
  title: "Сервис для дизайн-студии: заявки, бриф, КП",
  description:
    "Единый вход заявок, бриф клиента, риски и коммерческое предложение для студии. Прозрачность сделки до договора.",
  path: "/studios",
});

export default function StudiosPage() {
  return (
    <div className="landing min-h-screen">
      <LandingNav />
      <main>
        <section className="glow-amber relative overflow-hidden px-5 pb-16 pt-40 md:px-8">
          <div className="grid-arch absolute inset-0 opacity-40" aria-hidden />
          <div className="relative mx-auto max-w-[1280px]">
            <Cine className="max-w-[840px]">
              <p className="cine mb-4 text-[12px] uppercase tracking-[0.24em] text-bronze">{L.nav.studios}</p>
              <h1 className="cine font-display text-[clamp(34px,5.4vw,64px)] font-semibold leading-[1.04] text-ivory" style={delay(1)}>
                {p.title}
              </h1>
              <p className="cine mt-6 max-w-[58ch] text-[16px] leading-relaxed text-ivory/70" style={delay(2)}>
                {p.sub}
              </p>
              <div className="cine mt-9 flex flex-wrap gap-3" style={delay(3)}>
                <Link href="/pilot" className="btn-bronze">
                  {p.cta} <span aria-hidden>→</span>
                </Link>
                <Link href="/demo" className="btn-dark-ghost">
                  {L.risks.cta}
                </Link>
              </div>
            </Cine>
          </div>
        </section>

        <section className="px-5 py-16 md:px-8">
          <div className="mx-auto max-w-[1280px]">
            <Cine>
              <Parallax amount={24} className="cine">
                <div className="relative aspect-[21/9] overflow-hidden rounded-2xl border border-linedark shadow-[0_48px_120px_-40px_rgba(0,0,0,0.85)]">
                  <Image src={MEDIA.review} alt="Review Board студии — демонстрационный интерфейс" fill sizes="100vw" className="object-cover" />
                </div>
              </Parallax>
            </Cine>
            <Cine className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {p.points.map(([t, c], i) => (
                <div key={t} className="cine glass p-6" style={delay(i % 3)}>
                  <div className="mb-2 text-[15px] font-semibold text-ivory">{t}</div>
                  <p className="text-[13.5px] leading-relaxed text-ivory/60">{c}</p>
                </div>
              ))}
            </Cine>
          </div>
        </section>

        <section className="border-t border-linedark px-5 py-24 text-center md:px-8">
          <Cine className="mx-auto max-w-[720px]">
            <h2 className="cine font-display text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.06] text-ivory">
              {L.studios.cta}
            </h2>
            <p className="cine mx-auto mt-4 max-w-[54ch] text-[15px] leading-relaxed text-ivory/70" style={delay(1)}>
              {ru.landing.pagePilot.sub}
            </p>
            <div className="cine mt-8 flex flex-wrap items-center justify-center gap-3" style={delay(2)}>
              <Link href="/pilot#request" className="btn-bronze">
                {p.cta} <span aria-hidden>→</span>
              </Link>
              <Link href="/demo/proposal" className="btn-dark-ghost">
                {L.cta.c3}
              </Link>
            </div>
          </Cine>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
