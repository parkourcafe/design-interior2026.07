import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import LandingNav from "@/components/landing/nav";
import LandingFooter from "@/components/landing/footer";
import { Cine, Parallax } from "@/components/landing/cinema";
import { delay } from "@/components/landing/delay";
import { MEDIA } from "@/components/landing/media";

const p = ru.landing.pageDesigners;
const L = ru.landing;

export const metadata: Metadata = {
  title: `${L.nav.designers} — ${ru.app.name}`,
  description: p.sub,
};

export default function DesignersPage() {
  const stepMedia = [MEDIA.clientBrief, MEDIA.risks, MEDIA.proposal];
  return (
    <div className="landing min-h-screen">
      <LandingNav />
      <main>
        {/* Герой страницы */}
        <section className="glow-amber relative overflow-hidden px-5 pb-16 pt-40 md:px-8">
          <div className="grid-arch absolute inset-0 opacity-40" aria-hidden />
          <div className="relative mx-auto max-w-[1280px]">
            <Cine className="max-w-[840px]">
              <p className="cine mb-4 text-[12px] uppercase tracking-[0.24em] text-bronze">{L.nav.designers}</p>
              <h1 className="cine font-display text-[clamp(34px,5.4vw,64px)] font-semibold leading-[1.04] text-ivory" style={delay(1)}>
                {p.title}
              </h1>
              <p className="cine mt-6 max-w-[58ch] text-[16px] leading-relaxed text-ivory/70" style={delay(2)}>
                {p.sub}
              </p>
              <div className="cine mt-9 flex flex-wrap gap-3" style={delay(3)}>
                <Link href="/login" className="btn-bronze">
                  {p.cta} <span aria-hidden>→</span>
                </Link>
                <Link href="/demo/brief" className="btn-dark-ghost">
                  {L.hero.cta1}
                </Link>
              </div>
            </Cine>
          </div>
        </section>

        {/* Три шага */}
        <section className="px-5 py-20 md:px-8">
          <div className="mx-auto max-w-[1280px] space-y-20">
            {p.steps.map(([t, c], i) => (
              <Cine key={t}>
                <div className={`cine grid items-center gap-10 lg:grid-cols-2 ${i % 2 ? "" : ""}`}>
                  <div className={i % 2 ? "lg:order-2" : ""}>
                    <div className="font-display mb-4 text-[44px] leading-none text-bronze/70">
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <h2 className="font-display text-[clamp(26px,3.6vw,40px)] font-semibold leading-[1.08] text-ivory">{t}</h2>
                    <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-ivory/70">{c}</p>
                  </div>
                  <div className={i % 2 ? "lg:order-1" : ""}>
                    <Parallax amount={22}>
                      <div className="relative aspect-[16/9] overflow-hidden rounded-2xl border border-linedark shadow-[0_40px_100px_-40px_rgba(0,0,0,0.8)]">
                        <Image src={stepMedia[i] ?? MEDIA.clientBrief} alt={t} fill sizes="(max-width:1024px) 100vw, 620px" className="object-cover" />
                      </div>
                    </Parallax>
                  </div>
                </div>
              </Cine>
            ))}
          </div>
        </section>

        {/* Владение клиентом */}
        <section className="border-y border-linedark bg-coal2/50 px-5 py-20 md:px-8">
          <div className="mx-auto grid max-w-[1280px] items-center gap-12 lg:grid-cols-2">
            <Cine>
              <h2 className="cine font-display text-[clamp(28px,4vw,44px)] font-semibold leading-[1.08] text-ivory">
                {p.ownershipTitle}
              </h2>
              <p className="cine mt-4 max-w-[52ch] text-[15px] leading-relaxed text-ivory/70" style={delay(1)}>
                {p.ownershipCopy}
              </p>
              <p className="cine font-display mt-6 text-[22px] italic text-bronze" style={delay(2)}>
                {L.ownership.trust}
              </p>
            </Cine>
            <Cine>
              <div className="cine relative aspect-[16/9] overflow-hidden rounded-2xl border border-linedark">
                <Image src={MEDIA.ownership} alt={p.ownershipTitle} fill sizes="(max-width:1024px) 100vw, 620px" className="object-cover" />
              </div>
            </Cine>
          </div>
        </section>

        {/* CTA */}
        <section className="px-5 py-24 text-center md:px-8">
          <Cine className="mx-auto max-w-[720px]">
            <h2 className="cine font-display text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.06] text-ivory">
              {L.cta.title}
            </h2>
            <div className="cine mt-8 flex flex-wrap items-center justify-center gap-3" style={delay(1)}>
              <Link href="/login" className="btn-bronze">
                {p.cta} <span aria-hidden>→</span>
              </Link>
              <Link href="/demo" className="btn-dark-ghost">
                {L.risks.cta}
              </Link>
            </div>
            <p className="cine mt-6 text-[12.5px] text-ivorymuted" style={delay(2)}>
              {L.cta.trust}
            </p>
          </Cine>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
