import Image from "next/image";
import Link from "next/link";
import LandingNav from "@/components/landing/nav";
import LandingFooter from "@/components/landing/footer";
import { Cine, Parallax } from "@/components/landing/cinema";
import { delay } from "@/components/landing/delay";
import { FaqJsonLd } from "@/components/faq-json-ld";
import { ru } from "@/lib/i18n/ru";

// Общий рендерер money-страниц (эталон — документ 29). Кинематографичная
// дизайн-система лендинга; весь копирайт приходит данными из lib/i18n/ru.ts.
// Одна страница = один H1 = один интент. FAQ-секция сама отдаёт FAQPage-разметку.

type Cta = { readonly label: string; readonly href: string };
type Pair = readonly [string, string];

type Section =
  | { readonly kind: "prose"; readonly h2: string; readonly body: string }
  | { readonly kind: "steps"; readonly h2: string; readonly items: readonly Pair[] }
  | { readonly kind: "features"; readonly h2: string; readonly items: readonly Pair[] }
  | {
      readonly kind: "table";
      readonly h2: string;
      readonly head: readonly string[];
      readonly rows: readonly (readonly string[])[];
      readonly highlight?: number;
    }
  | { readonly kind: "faq"; readonly h2: string; readonly items: readonly { readonly q: string; readonly a: string }[] };

export type SeoPageData = {
  readonly eyebrow: string;
  readonly h1: string;
  readonly sub: string;
  readonly ctaPrimary: Cta;
  readonly ctaSecondary?: Cta;
  readonly sections: readonly Section[];
  readonly finalH2: string;
  readonly finalSub?: string;
  readonly finalCta: Cta;
  readonly relatedLabel?: string;
  readonly related: readonly Cta[];
};

function ProseSection({ s }: { s: Extract<Section, { kind: "prose" }> }) {
  return (
    <section className="border-t border-linedark px-5 py-16 md:px-8">
      <Cine className="mx-auto max-w-[760px]">
        <h2 className="cine font-display text-[clamp(26px,3.6vw,40px)] font-semibold leading-[1.1] text-ivory">
          {s.h2}
        </h2>
        <p className="cine mt-5 text-[16px] leading-relaxed text-ivory/70" style={delay(1)}>
          {s.body}
        </p>
      </Cine>
    </section>
  );
}

function StepsSection({ s }: { s: Extract<Section, { kind: "steps" }> }) {
  return (
    <section className="border-t border-linedark px-5 py-16 md:px-8">
      <div className="mx-auto max-w-[1280px]">
        <Cine>
          <h2 className="cine font-display text-[clamp(26px,3.6vw,40px)] font-semibold leading-[1.1] text-ivory">
            {s.h2}
          </h2>
          <ol className="cine mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4" style={delay(1)}>
            {s.items.map(([t, d], i) => (
              <li key={t} className="cine glass p-6" style={delay(i)}>
                <div className="mb-3 text-[13px] font-semibold text-bronze">{String(i + 1).padStart(2, "0")}</div>
                <div className="mb-2 text-[15px] font-semibold text-ivory">{t}</div>
                <p className="text-[13.5px] leading-relaxed text-ivory/60">{d}</p>
              </li>
            ))}
          </ol>
        </Cine>
      </div>
    </section>
  );
}

function FeaturesSection({ s }: { s: Extract<Section, { kind: "features" }> }) {
  return (
    <section className="border-t border-linedark px-5 py-16 md:px-8">
      <div className="mx-auto max-w-[1280px]">
        <Cine>
          <h2 className="cine font-display text-[clamp(26px,3.6vw,40px)] font-semibold leading-[1.1] text-ivory">
            {s.h2}
          </h2>
          <div className="cine mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3" style={delay(1)}>
            {s.items.map(([t, d], i) => (
              <div key={t} className="cine glass p-6" style={delay(i % 3)}>
                <div className="mb-2 text-[15px] font-semibold text-ivory">{t}</div>
                <p className="text-[13.5px] leading-relaxed text-ivory/60">{d}</p>
              </div>
            ))}
          </div>
        </Cine>
      </div>
    </section>
  );
}

function TableSection({ s }: { s: Extract<Section, { kind: "table" }> }) {
  return (
    <section className="border-t border-linedark px-5 py-16 md:px-8">
      <div className="mx-auto max-w-[1000px]">
        <Cine>
          <h2 className="cine font-display text-[clamp(26px,3.6vw,40px)] font-semibold leading-[1.1] text-ivory">
            {s.h2}
          </h2>
          <div className="cine mt-8 overflow-x-auto" style={delay(1)}>
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-linedark">
                  {s.head.map((h) => (
                    <th key={h} className="px-4 py-3 text-[13px] font-semibold uppercase tracking-wide text-ivory/50">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.rows.map((row, ri) => (
                  <tr
                    key={row[0]}
                    className={`border-b border-linedark ${ri === s.highlight ? "bg-bronze/10" : ""}`}
                  >
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={`px-4 py-3 text-[14px] ${
                          ci === 0 || ri === s.highlight ? "font-semibold text-ivory" : "text-ivory/70"
                        }`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Cine>
      </div>
    </section>
  );
}

function FaqSection({ s }: { s: Extract<Section, { kind: "faq" }> }) {
  return (
    <section className="border-t border-linedark px-5 py-16 md:px-8">
      <div className="mx-auto max-w-[760px]">
        <Cine>
          <h2 className="cine font-display text-[clamp(26px,3.6vw,40px)] font-semibold leading-[1.1] text-ivory">
            {s.h2}
          </h2>
          <div className="cine mt-8 divide-y divide-linedark border-y border-linedark" style={delay(1)}>
            {s.items.map((f) => (
              <details key={f.q} className="group px-1 py-4">
                <summary className="cursor-pointer list-none text-[15.5px] font-medium text-ivory marker:content-none">
                  {f.q}
                </summary>
                <p className="mt-3 text-[14px] leading-relaxed text-ivory/65">{f.a}</p>
              </details>
            ))}
          </div>
        </Cine>
        <FaqJsonLd items={s.items} />
      </div>
    </section>
  );
}

export default function SeoContentPage({
  data,
  heroMedia,
  heroAlt,
}: {
  data: SeoPageData;
  heroMedia?: string;
  heroAlt?: string;
}) {
  return (
    <div className="landing min-h-screen">
      <LandingNav />
      <main>
        {/* Hero */}
        <section className="glow-amber relative overflow-hidden px-5 pb-16 pt-40 md:px-8">
          <div className="grid-arch absolute inset-0 opacity-40" aria-hidden />
          <div className="relative mx-auto max-w-[1280px]">
            <Cine className="max-w-[840px]">
              <p className="cine mb-4 text-[12px] uppercase tracking-[0.24em] text-bronze">{data.eyebrow}</p>
              <h1
                className="cine font-display text-[clamp(34px,5.4vw,64px)] font-semibold leading-[1.04] text-ivory"
                style={delay(1)}
              >
                {data.h1}
              </h1>
              <p className="cine mt-6 max-w-[58ch] text-[16px] leading-relaxed text-ivory/70" style={delay(2)}>
                {data.sub}
              </p>
              <div className="cine mt-9 flex flex-wrap gap-3" style={delay(3)}>
                <Link href={data.ctaPrimary.href} className="btn-bronze">
                  {data.ctaPrimary.label} <span aria-hidden>→</span>
                </Link>
                {data.ctaSecondary ? (
                  <Link href={data.ctaSecondary.href} className="btn-dark-ghost">
                    {data.ctaSecondary.label}
                  </Link>
                ) : null}
              </div>
            </Cine>
          </div>
        </section>

        {/* Optional hero media */}
        {heroMedia ? (
          <section className="px-5 pb-4 md:px-8">
            <div className="mx-auto max-w-[1280px]">
              <Cine>
                <Parallax amount={24} className="cine">
                  <div className="relative aspect-[21/9] overflow-hidden rounded-2xl border border-linedark shadow-[0_48px_120px_-40px_rgba(0,0,0,0.85)]">
                    <Image src={heroMedia} alt={heroAlt ?? data.h1} fill sizes="100vw" className="object-cover" />
                  </div>
                </Parallax>
              </Cine>
            </div>
          </section>
        ) : null}

        {data.sections.map((s) => {
          switch (s.kind) {
            case "prose":
              return <ProseSection key={s.h2} s={s} />;
            case "steps":
              return <StepsSection key={s.h2} s={s} />;
            case "features":
              return <FeaturesSection key={s.h2} s={s} />;
            case "table":
              return <TableSection key={s.h2} s={s} />;
            case "faq":
              return <FaqSection key={s.h2} s={s} />;
          }
        })}

        {/* Final CTA + перелинковка */}
        <section className="border-t border-linedark px-5 py-24 text-center md:px-8">
          <Cine className="mx-auto max-w-[720px]">
            <h2 className="cine font-display text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.06] text-ivory">
              {data.finalH2}
            </h2>
            {data.finalSub ? (
              <p className="cine mx-auto mt-4 max-w-[54ch] text-[15px] leading-relaxed text-ivory/70" style={delay(1)}>
                {data.finalSub}
              </p>
            ) : null}
            <div className="cine mt-8 flex justify-center" style={delay(2)}>
              <Link href={data.finalCta.href} className="btn-bronze">
                {data.finalCta.label} <span aria-hidden>→</span>
              </Link>
            </div>
            <nav
              aria-label={data.relatedLabel ?? ru.seo.relatedLabel}
              className="cine mt-12 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13.5px] text-ivory/55"
              style={delay(3)}
            >
              {data.related.map((r) => (
                <Link key={r.href} href={r.href} className="hover:text-ivory">
                  {r.label}
                </Link>
              ))}
            </nav>
          </Cine>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
