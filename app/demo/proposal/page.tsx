import type { Metadata } from "next";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import LandingNav from "@/components/landing/nav";
import LandingFooter from "@/components/landing/footer";
import { Cine } from "@/components/landing/cinema";
import { delay } from "@/components/landing/delay";
import RespondDemo from "./respond-demo";

const d = ru.landing.demo;
const dp = ru.landing.demoProposal;

export const metadata: Metadata = {
  title: `${d.proposalTitle} — ${ru.app.name}`,
  description: d.proposalSub,
};

// Demo-КП: премиальный «бумажный» документ на тёмной сцене + витрина CTA
// принятия. Все данные демонстрационные; настоящий поток живёт на /p/[token].
export default function DemoProposalPage() {
  return (
    <div className="landing min-h-screen">
      <LandingNav />
      <main className="glow-amber relative px-5 pb-24 pt-32 md:px-8">
        <div className="grid-arch pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <div className="relative mx-auto max-w-[760px]">
          <Cine className="mb-10 text-center">
            <span className="cine inline-block rounded-full border border-olive/40 bg-olive/10 px-3.5 py-1 text-[11px] uppercase tracking-[0.16em] text-olive">
              {d.badge}
            </span>
            <h1 className="cine font-display mt-5 text-[clamp(30px,4.6vw,48px)] font-semibold leading-[1.06] text-ivory" style={delay(1)}>
              {d.proposalTitle}
            </h1>
            <p className="cine mx-auto mt-4 max-w-[54ch] text-[15px] leading-relaxed text-ivory/70" style={delay(2)}>
              {d.proposalSub}
            </p>
          </Cine>

          <Cine>
            <article className="cine rounded-2xl border border-line bg-paper p-7 text-ink shadow-[0_60px_140px_-48px_rgba(0,0,0,0.95)] sm:p-10">
              <header className="mb-8 border-b border-line pb-6">
                <p className="text-[11px] uppercase tracking-[0.2em] text-muted">{ru.proposal.title}</p>
                <h2 className="font-display mt-1.5 text-[clamp(24px,3.4vw,32px)] font-semibold leading-tight">
                  {d.proposalClient}
                </h2>
                <p className="mt-2 text-[13px] text-muted">{d.briefStudio}</p>
              </header>

              <div className="space-y-7">
                {dp.sections.map(([title, body]) => (
                  <section key={title}>
                    <h3 className="font-display mb-2 text-[21px] font-semibold">{title}</h3>
                    <p className="text-[14.5px] leading-[1.75] text-ink/85">{body}</p>
                  </section>
                ))}
              </div>

              <div className="mt-9">
                <RespondDemo />
              </div>
            </article>
          </Cine>

          <Cine className="mt-12 text-center">
            <div className="cine flex flex-wrap items-center justify-center gap-3">
              <Link href="/login" className="btn-bronze">
                {d.tryYours} <span aria-hidden>→</span>
              </Link>
              <Link href="/demo" className="btn-dark-ghost">
                {d.loopTitle}
              </Link>
            </div>
          </Cine>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
