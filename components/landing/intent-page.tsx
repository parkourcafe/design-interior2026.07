import Link from "next/link";
import LandingNav from "@/components/landing/nav";
import LandingFooter from "@/components/landing/footer";
import { Cine } from "@/components/landing/cinema";
import { delay } from "@/components/landing/delay";
import { FaqJsonLd } from "@/components/faq-json-ld";
import { ru } from "@/lib/i18n/ru";

// Общий рендерер интент-страниц. Кинематографичная дизайн-система лендинга;
// весь копирайт приходит данными из lib/i18n. Один H1 = один интент.

type Cta = { readonly label: string; readonly href: string };
type Pair = readonly [string, string];

export type IntentSection =
  | { readonly kind: "prose"; readonly h2: string; readonly body: string }
  | { readonly kind: "list"; readonly h2: string; readonly intro?: string; readonly items: readonly Pair[] }
  | { readonly kind: "steps"; readonly h2: string; readonly items: readonly Pair[] }
  | { readonly kind: "faq"; readonly h2: string; readonly items: readonly { readonly q: string; readonly a: string }[] };

export type IntentPageData = {
  readonly eyebrow: string;
  readonly h1: string;
  readonly sub: string;
  readonly ctaPrimary?: Cta;
  readonly ctaSecondary?: Cta;
  readonly sections: readonly IntentSection[];
  readonly finalH2: string;
  readonly finalSub?: string;
  readonly finalCta?: Cta;
  readonly related: readonly Cta[];
};

function Prose({ s }: { s: Extract<IntentSection, { kind: "prose" }> }) {
  return (
    <section className="border-t border-linedark px-5 py-14 md:px-8">
      <Cine className="mx-auto max-w-[760px]">
        <h2 className="cine font-display text-[clamp(24px,3.4vw,36px)] font-semibold leading-[1.12] text-ivory">
          {s.h2}
        </h2>
        <p className="cine mt-5 whitespace-pre-line text-[16px] leading-relaxed text-ivory/70" style={delay(1)}>
          {s.body}
        </p>
      </Cine>
    </section>
  );
}

function ListBlock({ s }: { s: Extract<IntentSection, { kind: "list" }> }) {
  return (
    <section className="border-t border-linedark px-5 py-14 md:px-8">
      <div className="mx-auto max-w-[1080px]">
        <Cine>
          <h2 className="cine font-display text-[clamp(24px,3.4vw,36px)] font-semibold leading-[1.12] text-ivory">
            {s.h2}
          </h2>
          {s.intro ? (
            <p className="cine mt-4 max-w-[70ch] text-[15.5px] leading-relaxed text-ivory/70" style={delay(1)}>
              {s.intro}
            </p>
          ) : null}
          <div className="cine mt-9 grid gap-5 md:grid-cols-2 xl:grid-cols-3" style={delay(2)}>
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

function Steps({ s }: { s: Extract<IntentSection, { kind: "steps" }> }) {
  return (
    <section className="border-t border-linedark px-5 py-14 md:px-8">
      <div className="mx-auto max-w-[1080px]">
        <Cine>
          <h2 className="cine font-display text-[clamp(24px,3.4vw,36px)] font-semibold leading-[1.12] text-ivory">
            {s.h2}
          </h2>
          <ol className="cine mt-9 grid gap-5 md:grid-cols-2 xl:grid-cols-4" style={delay(1)}>
            {s.items.map(([t, d], i) => (
              <li key={t} className="cine glass p-6" style={delay(i)}>
                <div className="mb-3 text-[13px] font-semibold text-bronze">
                  {String(i + 1).padStart(2, "0")}
                </div>
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

function Faq({ s }: { s: Extract<IntentSection, { kind: "faq" }> }) {
  return (
    <section className="border-t border-linedark px-5 py-14 md:px-8">
      <div className="mx-auto max-w-[760px]">
        <Cine>
          <h2 className="cine font-display text-[clamp(24px,3.4vw,36px)] font-semibold leading-[1.12] text-ivory">
            {s.h2}
          </h2>
          <div className="cine mt-8 divide-y divide-linedark border-y border-linedark" style={delay(1)}>
            {s.items.map((f) => (
              <details key={f.q} className="group px-1 py-4">
                <summary className="cursor-pointer list-none text-[15.5px] font-medium text-ivory marker:content-none">
                  {f.q}
                </summary>
                <p className="mt-3 whitespace-pre-line text-[14px] leading-relaxed text-ivory/65">{f.a}</p>
              </details>
            ))}
          </div>
        </Cine>
        <FaqJsonLd items={s.items} />
      </div>
    </section>
  );
}

export default function IntentPage({ data }: { data: IntentPageData }) {
  return (
    <div className="landing min-h-screen">
      <LandingNav />
      <main>
        <section className="glow-amber relative overflow-hidden px-5 pb-14 pt-40 md:px-8">
          <div className="grid-arch absolute inset-0 opacity-40" aria-hidden />
          <div className="relative mx-auto max-w-[1080px]">
            <Cine className="max-w-[820px]">
              <p className="cine mb-4 text-[12px] uppercase tracking-[0.24em] text-bronze">{data.eyebrow}</p>
              <h1
                className="cine font-display text-[clamp(30px,4.8vw,56px)] font-semibold leading-[1.06] text-ivory"
                style={delay(1)}
              >
                {data.h1}
              </h1>
              <p className="cine mt-6 max-w-[62ch] text-[16px] leading-relaxed text-ivory/70" style={delay(2)}>
                {data.sub}
              </p>
              {data.ctaPrimary ? (
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
              ) : null}
            </Cine>
          </div>
        </section>

        {data.sections.map((s) => {
          switch (s.kind) {
            case "prose":
              return <Prose key={s.h2} s={s} />;
            case "list":
              return <ListBlock key={s.h2} s={s} />;
            case "steps":
              return <Steps key={s.h2} s={s} />;
            case "faq":
              return <Faq key={s.h2} s={s} />;
          }
        })}

        <section className="border-t border-linedark px-5 py-20 text-center md:px-8">
          <Cine className="mx-auto max-w-[720px]">
            <h2 className="cine font-display text-[clamp(26px,4vw,44px)] font-semibold leading-[1.08] text-ivory">
              {data.finalH2}
            </h2>
            {data.finalSub ? (
              <p className="cine mx-auto mt-4 max-w-[56ch] text-[15px] leading-relaxed text-ivory/70" style={delay(1)}>
                {data.finalSub}
              </p>
            ) : null}
            {data.finalCta ? (
              <div className="cine mt-8 flex justify-center" style={delay(2)}>
                <Link href={data.finalCta.href} className="btn-bronze">
                  {data.finalCta.label} <span aria-hidden>→</span>
                </Link>
              </div>
            ) : null}
            <nav
              aria-label={ru.intents.relatedLabel}
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
