import type { Metadata } from "next";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import LandingNav from "@/components/landing/nav";
import LandingFooter from "@/components/landing/footer";
import { Cine } from "@/components/landing/cinema";
import { delay } from "@/components/landing/delay";
import PilotForm from "./pilot-form";

const p = ru.landing.pagePilot;
const L = ru.landing;

export const metadata: Metadata = {
  title: `${p.title} — ${ru.app.name}`,
  description: p.sub,
};

// Тарифов нет по дизайну: идёт бесплатный пилот (см. FAQ/стратегию).
// Страница продаёт пилот и собирает заявку — без выдуманных тарифных сеток.
export default function PilotPage() {
  return (
    <div className="landing min-h-screen">
      <LandingNav />
      <main className="relative px-5 pb-24 pt-40 md:px-8">
        <div className="glow-amber pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-[1080px]">
          <Cine className="mb-12 max-w-[760px]">
            <p className="cine mb-4 text-[12px] uppercase tracking-[0.24em] text-bronze">{L.nav.pilot}</p>
            <h1 className="cine font-display text-[clamp(34px,5.2vw,60px)] font-semibold leading-[1.05] text-ivory" style={delay(1)}>
              {p.title}
            </h1>
            <p className="cine mt-5 max-w-[58ch] text-[15.5px] leading-relaxed text-ivory/70" style={delay(2)}>
              {p.sub}
            </p>
          </Cine>

          <div className="mb-6 grid gap-5 md:grid-cols-2">
            {p.forWho.map(([title, items], i) => (
              <Cine key={title as string}>
                <div className="cine glass h-full p-7" style={delay(i)}>
                  <h2 className="font-display mb-5 text-[24px] font-semibold text-ivory">{title as string}</h2>
                  <ul className="space-y-2.5">
                    {(items as readonly string[]).map((it) => (
                      <li key={it} className="flex items-start gap-3 text-[14px] text-ivory/75">
                        <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-olive/20 text-[10px] text-olive">
                          ✓
                        </span>
                        {it}
                      </li>
                    ))}
                  </ul>
                </div>
              </Cine>
            ))}
          </div>

          <Cine className="mb-16">
            <p className="cine text-[13px] text-ivorymuted">{p.noNote}</p>
          </Cine>

          <div id="request" className="scroll-mt-28">
            <Cine>
              <div className="cine">
                <PilotForm />
              </div>
            </Cine>
          </div>

          <Cine className="mt-14 text-center">
            <div className="cine flex flex-wrap items-center justify-center gap-3">
              <Link href="/demo/brief" className="btn-dark-ghost">
                {L.hero.cta1}
              </Link>
              <Link href="/demo/proposal" className="btn-dark-ghost">
                {L.cta.c3}
              </Link>
            </div>
          </Cine>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
