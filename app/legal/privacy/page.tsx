import { pageMetadata } from "@/lib/seo";
import { ru } from "@/lib/i18n/ru";
import LandingNav from "@/components/landing/nav";
import LandingFooter from "@/components/landing/footer";

const l = ru.landing.legal;

export const metadata = pageMetadata({
  title: l.privacyTitle,
  description: l.pilotBanner,
  path: "/legal/privacy",
});

// Юридические страницы — намеренно спокойные и читабельные, без «кино».
// Реквизиты оператора НЕ выдумываем: их отсутствие — блокер публичного
// запуска, о чём страница говорит прямо (баннер ниже).
export default function PrivacyPage() {
  return (
    <div className="landing min-h-screen">
      <LandingNav />
      <main className="mx-auto max-w-[760px] px-5 pb-24 pt-40 md:px-8">
        <h1 className="font-display text-[clamp(30px,4.6vw,46px)] font-semibold leading-[1.08] text-ivory">
          {l.privacyTitle}
        </h1>
        <p className="mt-2 text-[13px] text-ivorymuted">
          {l.updated}: 05.07.2026
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
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
