import Link from "next/link";
import { intentPageMetadata } from "@/lib/seo/page-metadata";
import LandingNav from "@/components/landing/nav";
import LandingFooter from "@/components/landing/footer";
import { Cine } from "@/components/landing/cinema";
import { delay } from "@/components/landing/delay";
import { ru } from "@/lib/i18n/ru";
import { ruIntentsClient } from "@/lib/i18n/ru-intents-client";
import { PUBLISHED_INTENTS } from "@/lib/seo/intents";

// Хаб клиентского кластера. Без него 11 страниц остались бы сиротами без
// родителя — плохо и для навигации, и для обхода роботом.
const h = ru.intents.hubClients;

export const metadata = intentPageMetadata({
  title: h.h1,
  description: h.sub,
  path: "/for-clients",
});

export default function ForClientsHub() {
  const pages = PUBLISHED_INTENTS.filter((i) => i.segment === "client").map((i) => ({
    href: i.route,
    title: ruIntentsClient[i.id as keyof typeof ruIntentsClient].h1,
    sub: ruIntentsClient[i.id as keyof typeof ruIntentsClient].sub,
  }));

  return (
    <div className="landing min-h-screen">
      <LandingNav />
      <main>
        <section className="glow-amber relative overflow-hidden px-5 pb-14 pt-40 md:px-8">
          <div className="grid-arch absolute inset-0 opacity-40" aria-hidden />
          <div className="relative mx-auto max-w-[1080px]">
            <Cine className="max-w-[820px]">
              <p className="cine mb-4 text-[12px] uppercase tracking-[0.24em] text-bronze">{h.eyebrow}</p>
              <h1
                className="cine font-display text-[clamp(30px,4.8vw,56px)] font-semibold leading-[1.06] text-ivory"
                style={delay(1)}
              >
                {h.h1}
              </h1>
              <p className="cine mt-6 max-w-[62ch] text-[16px] leading-relaxed text-ivory/70" style={delay(2)}>
                {h.sub}
              </p>
            </Cine>
          </div>
        </section>

        <section className="border-t border-linedark px-5 py-14 md:px-8">
          <div className="mx-auto max-w-[1080px]">
            <Cine>
              <div className="cine grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {pages.map((p, i) => (
                  <Link key={p.href} href={p.href} className="cine glass block p-6 hover:border-bronze/40" style={delay(i % 3)}>
                    <div className="mb-2 text-[15px] font-semibold text-ivory">{p.title}</div>
                    <p className="line-clamp-3 text-[13.5px] leading-relaxed text-ivory/60">{p.sub}</p>
                  </Link>
                ))}
              </div>
            </Cine>
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
