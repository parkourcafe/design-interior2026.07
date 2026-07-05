import Link from "next/link";
import { ru } from "@/lib/i18n/ru";

const f = ru.landing.footer;
const n = ru.landing.nav;

// Контакт поддержки: env позволяет заменить без релиза кода.
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "parkourcafe@gmail.com";

export default function LandingFooter() {
  return (
    <footer className="landing border-t border-linedark">
      <div className="mx-auto max-w-[1280px] px-5 py-14 md:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="font-display text-[26px] font-semibold text-ivory">{ru.app.name}</div>
            <p className="mt-2 max-w-[40ch] text-sm leading-relaxed text-ivorymuted">{f.tagline}</p>
            <p className="mt-5 max-w-[46ch] text-[13px] leading-relaxed text-ivorymuted/80">{f.pilotNote}</p>
          </div>
          <nav aria-label={f.product} className="flex flex-col gap-2.5 text-sm">
            <span className="mb-1 text-[11px] uppercase tracking-[0.2em] text-ivorymuted/70">{f.product}</span>
            <Link className="text-ivorymuted hover:text-ivory" href="/designers">{n.designers}</Link>
            <Link className="text-ivorymuted hover:text-ivory" href="/studios">{n.studios}</Link>
            <Link className="text-ivorymuted hover:text-ivory" href="/demo/brief">{n.demoBrief}</Link>
            <Link className="text-ivorymuted hover:text-ivory" href="/demo/proposal">{n.demoProposal}</Link>
            <Link className="text-ivorymuted hover:text-ivory" href="/pilot">{n.pilot}</Link>
          </nav>
          <nav aria-label={f.company} className="flex flex-col gap-2.5 text-sm">
            <span className="mb-1 text-[11px] uppercase tracking-[0.2em] text-ivorymuted/70">{f.company}</span>
            <Link className="text-ivorymuted hover:text-ivory" href="/security">{n.security}</Link>
            <Link className="text-ivorymuted hover:text-ivory" href="/legal/privacy">{f.legalPrivacy}</Link>
            <Link className="text-ivorymuted hover:text-ivory" href="/legal/terms">{f.legalTerms}</Link>
            <a className="text-ivorymuted hover:text-ivory" href={`mailto:${SUPPORT_EMAIL}`}>
              {f.support}: {SUPPORT_EMAIL}
            </a>
          </nav>
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-linedark pt-6 text-[12.5px] text-ivorymuted/70">
          <span>{f.rights}</span>
          <span className="font-display text-[15px] text-ivorymuted">{ru.app.tagline}</span>
        </div>
      </div>
    </footer>
  );
}
