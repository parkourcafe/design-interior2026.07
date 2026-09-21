import type { Metadata } from "next";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import LandingNav from "@/components/landing/nav";
import LandingFooter from "@/components/landing/footer";
import OperatorDetails from "@/app/legal/operator-details";

const l = ru.landing.legal;

export const metadata: Metadata = {
  alternates: { canonical: "/legal/terms" },
  openGraph: { url: "/legal/terms" },
  title: `${l.termsTitle} — ${ru.app.name}`,
  description: l.draftBanner,
  robots: { index: false, follow: false },
};

export default function TermsPage() {
  return (
    <div className="landing min-h-screen">
      <LandingNav />
      <main className="mx-auto max-w-[760px] px-5 pb-24 pt-40 md:px-8">
        <h1 className="font-display text-[clamp(30px,4.6vw,46px)] font-semibold leading-[1.08] text-ivory">
          {l.termsTitle}
        </h1>
        <p className="mt-2 text-ivorymuted">{l.updated}: {l.revisionDate}</p>
        <p className="mt-6 border-y border-linedark py-4 leading-relaxed text-ivory">{l.draftBanner}</p>
        <div className="mt-10 space-y-8">
          {l.terms.map(([title, content]) => (
            <section key={title}>
              <h2 className="mb-2 text-xl font-semibold text-ivory">{title}</h2>
              <p className="leading-relaxed text-ivorymuted">{content}</p>
            </section>
          ))}
        </div>
        <OperatorDetails />
        <nav className="mt-10 flex flex-wrap gap-x-6 gap-y-2" aria-label={l.operatorTitle}>
          <Link className="inline-flex min-h-11 items-center underline" href="/legal/privacy">{l.privacyTitle}</Link>
          <Link className="inline-flex min-h-11 items-center underline" href="/legal/terms">{l.termsTitle}</Link>
          <Link className="inline-flex min-h-11 items-center underline" href="/legal/consent">{l.consentTitle}</Link>
          <Link className="inline-flex min-h-11 items-center underline" href="/support">{l.supportTitle}</Link>
        </nav>
      </main>
      <LandingFooter />
    </div>
  );
}
