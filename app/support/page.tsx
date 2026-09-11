import type { Metadata } from "next";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import OperatorDetails from "@/app/legal/operator-details";
import { supportEmail } from "@/lib/env";

const l = ru.landing.legal;

export const metadata: Metadata = {
  alternates: { canonical: "/support" },
  openGraph: { url: "/support" },
  title: `${l.supportTitle} — ${ru.app.name}`,
  description: l.supportDescription,
  robots: { index: false, follow: false },
};

export default function SupportPage() {
  const email = supportEmail();
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-16">
      <Link href="/" className="text-sm text-muted hover:text-ink">← {ru.app.name}</Link>
      <h1 className="mt-8 font-display text-4xl font-semibold">{l.supportTitle}</h1>
      <p className="mt-5 leading-relaxed text-muted">
        {l.supportIntro}
      </p>
      <p className="mt-6 border-y border-line py-4">{l.draftBanner}</p>
      {!email.endsWith(".invalid") ? <a className="btn-primary mt-6 inline-flex break-all" href={`mailto:${email}`}>{email}</a> : null}
      <section className="mt-12 border-t border-line pt-8">
        <h2 className="font-display text-2xl font-semibold">{l.deletionTitle}</h2>
        <p className="mt-3 leading-relaxed text-muted">
          {l.deletionDescription}
        </p>
      </section>
      <OperatorDetails />
      <div className="mt-10 flex flex-wrap gap-5">
        <Link href="/legal/privacy" className="inline-flex min-h-11 items-center underline">{l.privacyTitle}</Link>
        <Link href="/legal/terms" className="inline-flex min-h-11 items-center underline">{l.termsTitle}</Link>
      </div>
    </main>
  );
}
