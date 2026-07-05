import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import LandingNav from "@/components/landing/nav";
import LandingFooter from "@/components/landing/footer";
import { Cine } from "@/components/landing/cinema";
import { delay } from "@/components/landing/delay";
import { MEDIA } from "@/components/landing/media";

const p = ru.landing.pageSecurity;
const L = ru.landing;

export const metadata: Metadata = {
  title: `${p.title} — ${ru.app.name}`,
  description: p.sub,
};

export default function SecurityPage() {
  return (
    <div className="landing min-h-screen">
      <LandingNav />
      <main className="relative px-5 pb-24 pt-40 md:px-8">
        <div className="glow-amber pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-[980px]">
          <Cine className="mb-12 max-w-[720px]">
            <p className="cine mb-4 text-[12px] uppercase tracking-[0.24em] text-bronze">{L.nav.security}</p>
            <h1 className="cine font-display text-[clamp(32px,5vw,56px)] font-semibold leading-[1.05] text-ivory" style={delay(1)}>
              {p.title}
            </h1>
            <p className="cine mt-5 max-w-[56ch] text-[15.5px] leading-relaxed text-ivory/70" style={delay(2)}>
              {p.sub}
            </p>
          </Cine>

          <Cine>
            <div className="cine relative mb-12 aspect-[21/9] overflow-hidden rounded-2xl border border-linedark">
              <Image src={MEDIA.safety} alt={p.title} fill sizes="(max-width:1024px) 100vw, 980px" className="object-cover" />
            </div>
          </Cine>

          <div className="grid gap-5 md:grid-cols-2">
            {p.blocks.map(([t, c], i) => (
              <Cine key={t}>
                <div className="cine glass h-full p-7" style={delay(i % 2)}>
                  <h2 className="mb-2.5 text-[16.5px] font-semibold text-ivory">{t}</h2>
                  <p className="text-[14px] leading-relaxed text-ivory/65">{c}</p>
                </div>
              </Cine>
            ))}
          </div>

          <Cine className="mt-12">
            <p className="cine font-display text-[24px] italic leading-snug text-bronze">{L.ownership.trust}</p>
            <div className="cine mt-7 flex flex-wrap gap-3" style={delay(1)}>
              <Link href="/legal/privacy" className="btn-dark-ghost">
                {L.footer.legalPrivacy}
              </Link>
              <Link href="/legal/terms" className="btn-dark-ghost">
                {L.footer.legalTerms}
              </Link>
            </div>
          </Cine>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
