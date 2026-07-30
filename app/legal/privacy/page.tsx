import type { Metadata } from "next";
import { ru } from "@/lib/i18n/ru";
import { legalOperator } from "@/lib/env";
import LandingNav from "@/components/landing/nav";
import LandingFooter from "@/components/landing/footer";

const l = ru.landing.legal;

export const metadata: Metadata = {
  title: `${l.privacyTitle} — ${ru.app.name}`,
  description: l.pilotBanner,
};

export default function PrivacyPage() {
  const operator = legalOperator();

  return (
    <div className="landing min-h-screen">
      <LandingNav />
      <main className="mx-auto max-w-[760px] px-5 pb-24 pt-40 md:px-8">
        <h1 className="font-display text-[clamp(30px,4.6vw,46px)] font-semibold leading-[1.08] text-ivory">
          {l.privacyTitle}
        </h1>
        <p className="mt-2 text-[13px] text-ivorymuted">
          {l.updated}: 18.07.2026
        </p>
        <p className="mt-6 rounded-xl border border-bronze/40 bg-bronze/10 px-5 py-4 text-[13.5px] leading-relaxed text-ivory/85">
          {l.pilotBanner}
        </p>
        <div className="mt-10 space-y-8">
          {l.privacy.map(([t, c]) => (
            <section key={t}>
              <h2 className="mb-2 text-[17px] font-semibold text-ivory">{t}</h2>
              <p className="text-[14.5px] leading-[1.75] text-ivory/70">{c}</p>
            </section>
          ))}
          <section>
            <h2 className="mb-2 text-[17px] font-semibold text-ivory">Оператор и контакт</h2>
            <div className="space-y-1 text-[14.5px] leading-[1.75] text-ivory/70">
              <p>{operator.name}</p>
              {operator.address ? <p>{operator.address}</p> : null}
              <p>
                <a className="underline hover:text-ivory" href={`mailto:${operator.email}`}>
                  {operator.email}
                </a>
              </p>
              <p>
                <a className="underline hover:text-ivory" href={`tel:${operator.phone}`}>
                  {operator.phone}
                </a>
              </p>
            </div>
          </section>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
