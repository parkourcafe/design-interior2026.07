import Image from "next/image";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import LandingNav from "@/components/landing/nav";
import LandingFooter from "@/components/landing/footer";
import Hero from "@/components/landing/hero";
import FogScene from "@/components/landing/fog-scene";
import LoopScene from "@/components/landing/loop-scene";
import { Cine, Parallax } from "@/components/landing/cinema";
import { delay } from "@/components/landing/delay";
import { MEDIA } from "@/components/landing/media";

const L = ru.landing;

// ── Утилиты секций ───────────────────────────────────────────

function Head({
  eyebrow,
  title,
  copy,
  center = false,
}: {
  eyebrow: string;
  title: string;
  copy?: string;
  center?: boolean;
}) {
  return (
    <Cine className={`mb-12 max-w-[780px] ${center ? "mx-auto text-center" : ""}`}>
      <p className="cine mb-4 text-[12px] uppercase tracking-[0.24em] text-bronze" style={delay(0)}>
        {eyebrow}
      </p>
      <h2
        className="cine font-display text-[clamp(30px,4.2vw,52px)] font-semibold leading-[1.06] text-ivory"
        style={delay(1)}
      >
        {title}
      </h2>
      {copy && (
        <p className={`cine mt-5 text-[15.5px] leading-relaxed text-ivory/70 ${center ? "mx-auto" : ""} max-w-[62ch]`} style={delay(2)}>
          {copy}
        </p>
      )}
    </Cine>
  );
}

function Shot({ src, alt, ratio = "aspect-[16/9]" }: { src: string; alt: string; ratio?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-linedark ${ratio} shadow-[0_40px_100px_-40px_rgba(0,0,0,0.8)]`}>
      <Image src={src} alt={alt} fill sizes="(max-width: 1024px) 100vw, 1100px" className="object-cover" />
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-ivory/5" />
    </div>
  );
}

function Section({ id, children, className = "" }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`landing relative px-5 py-[clamp(72px,10vw,140px)] md:px-8 ${className}`}>
      <div className="mx-auto max-w-[1280px]">{children}</div>
    </section>
  );
}

// ── Главная ──────────────────────────────────────────────────

export default function Home() {
  return (
    <div className="landing min-h-screen">
      <LandingNav />
      <main>
        <Hero />
        <FogScene />
        <LoopScene />
        <HowItWorks />
        <ForDesigners />
        <ForStudios />
        <BriefEngine />
        <RiskCards />
        <PricingLogic />
        <ProposalBuilder />
        <ClientExperience />
        <Ownership />
        <DataSafety />
        <WhatItCreates />
        <MeetingAgenda />
        <Comparison />
        <NotThis />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}

// 4. Как работает
function HowItWorks() {
  const s = L.how;
  return (
    <Section id="how" className="glow-amber">
      <Head eyebrow={s.eyebrow} title={s.title} />
      <Cine className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {s.steps.map(([t, c], i) => (
          <div key={t} className="cine glass group p-7 transition-colors hover:border-bronze/40" style={delay(i)}>
            <div className="font-display mb-5 text-[38px] leading-none text-bronze/70 transition-colors group-hover:text-bronze">
              {String(i + 1).padStart(2, "0")}
            </div>
            <div className="mb-2.5 text-[16.5px] font-semibold text-ivory">{t}</div>
            <p className="text-[14px] leading-relaxed text-ivory/65">{c}</p>
          </div>
        ))}
      </Cine>
    </Section>
  );
}

// 5. Для дизайнеров
function ForDesigners() {
  const s = L.designers;
  const shots = [MEDIA.clientBrief, MEDIA.risks, MEDIA.agenda, MEDIA.proposal];
  const hrefs = ["/demo/brief", "/demo", "/demo", "/demo/proposal"];
  return (
    <Section id="designers">
      <Head eyebrow={s.eyebrow} title={s.title} />
      <div className="grid gap-6 md:grid-cols-2">
        {s.cards.map((card, i) => (
          <Cine key={card.title}>
            <div className="cine group overflow-hidden rounded-2xl border border-linedark bg-coal2 transition-colors hover:border-bronze/40" style={delay(i % 2)}>
              <div className="relative aspect-[16/9] overflow-hidden">
                <Image
                  src={shots[i] ?? MEDIA.clientBrief}
                  alt={card.title}
                  fill
                  sizes="(max-width: 768px) 100vw, 620px"
                  className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-coal2 via-transparent to-transparent" />
                <span className="absolute left-5 top-5 rounded-full border border-linedark bg-coal/70 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-ivory/85 backdrop-blur">
                  {card.tag}
                </span>
              </div>
              <div className="p-7">
                <h3 className="font-display mb-2.5 text-[24px] font-semibold leading-tight text-ivory">{card.title}</h3>
                <p className="mb-5 text-[14.5px] leading-relaxed text-ivory/65">{card.copy}</p>
                <Link href={hrefs[i] ?? "/demo"} className="inline-flex items-center gap-2 text-[14px] text-bronze underline-offset-4 hover:underline">
                  {card.cta} <span aria-hidden>→</span>
                </Link>
              </div>
            </div>
          </Cine>
        ))}
      </div>
      <Cine className="mt-10 text-center">
        <Link href="/designers" className="cine btn-dark-ghost">
          {L.nav.designers} <span aria-hidden>→</span>
        </Link>
      </Cine>
    </Section>
  );
}

// 6. Для студий
function ForStudios() {
  const s = L.studios;
  return (
    <Section id="studios" className="border-y border-linedark bg-coal2/50">
      <div className="grid items-center gap-12 lg:grid-cols-[1fr_1fr]">
        <div>
          <Head eyebrow={s.eyebrow} title={s.title} copy={s.copy} />
          <Cine className="grid gap-4 sm:grid-cols-2">
            {s.cards.map(([t, c], i) => (
              <div key={t} className="cine rounded-xl border border-linedark bg-coal/60 p-5" style={delay(i)}>
                <div className="mb-2 text-[14.5px] font-semibold text-ivory">{t}</div>
                <p className="text-[13px] leading-relaxed text-ivory/60">{c}</p>
              </div>
            ))}
          </Cine>
          <Cine className="mt-8">
            <Link href="/pilot" className="cine btn-bronze">
              {s.cta} <span aria-hidden>→</span>
            </Link>
          </Cine>
        </div>
        <Cine>
          <Parallax amount={26} className="cine">
            <Shot src={MEDIA.review} alt="Review Board дизайнера — демонстрационный интерфейс" />
          </Parallax>
        </Cine>
      </div>
    </Section>
  );
}

// 7. Движок брифа
function BriefEngine() {
  const s = L.engine;
  return (
    <Section className="glow-amber">
      <Head eyebrow={s.eyebrow} title={s.title} copy={s.copy} />
      <Cine className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {s.blocks.map(([t, c], i) => (
          <div key={t} className="cine glass p-6" style={delay(i)}>
            <div className="mb-3 h-8 w-8 rounded-lg border border-bronze/40 bg-bronze/10" aria-hidden />
            <div className="mb-2 text-[15.5px] font-semibold text-ivory">{t}</div>
            <p className="text-[13.5px] leading-relaxed text-ivory/60">{c}</p>
          </div>
        ))}
      </Cine>
      <Cine className="mt-8 flex flex-wrap items-center gap-2.5">
        <span className="cine text-[12.5px] text-ivorymuted">{s.metaNote}</span>
        {s.meta.map((m, i) => (
          <span key={m} className="cine rounded-full border border-olive/40 bg-olive/10 px-3 py-1 text-[12px] text-olive" style={delay(i + 1)}>
            {m}
          </span>
        ))}
      </Cine>
    </Section>
  );
}

// 8. Риск-карточки / доверие к AI
function RiskCards() {
  const s = L.risks;
  return (
    <Section id="risks">
      <div className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="lg:sticky lg:top-28">
          <Head eyebrow={s.eyebrow} title={s.title} copy={s.copy} />
          <Cine>
            <p className="cine font-display text-[22px] italic text-bronze">{s.principle}</p>
            <p className="cine mt-5 max-w-[52ch] rounded-xl border border-linedark bg-coal2/70 p-4 text-[13px] leading-relaxed text-ivory/60" style={delay(1)}>
              {s.fallback}
            </p>
            <Link href="/demo" className="cine mt-6 inline-flex items-center gap-2 text-[14.5px] text-bronze underline-offset-4 hover:underline" style={delay(2)}>
              {s.cta} <span aria-hidden>→</span>
            </Link>
          </Cine>
        </div>
        <div className="space-y-5">
          <Cine>
            <Parallax amount={20} className="cine">
              <Shot src={MEDIA.risks} alt="Риск-карточки вокруг плана квартиры — стилизованная демонстрация" />
            </Parallax>
          </Cine>
          {s.cards.map((c, i) => (
            <Cine key={c.type}>
              <div className="cine glass-strong p-6" style={delay(i % 2)}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-bronze">
                    Риск · {c.type}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="rounded-full border border-olive/40 bg-olive/10 px-2.5 py-0.5 text-[11px] text-olive">
                      {s.labels.source}: {c.source}
                    </span>
                    <span className="rounded-full bg-bronze/15 px-2.5 py-0.5 text-[11px] text-bronze">
                      {s.labels.confidence}: {c.confidence}
                    </span>
                  </span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="text-[10.5px] uppercase tracking-[0.16em] text-ivorymuted">{s.labels.evidence}</div>
                    <p className="mt-1 font-display text-[18px] leading-snug text-ivory">{c.evidence}</p>
                  </div>
                  <div>
                    <div className="text-[10.5px] uppercase tracking-[0.16em] text-ivorymuted">{s.labels.impact}</div>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-ivory/70">{c.impact}</p>
                  </div>
                </div>
              </div>
            </Cine>
          ))}
        </div>
      </div>
    </Section>
  );
}

// 9. Логика цены
function PricingLogic() {
  const s = L.pricing;
  return (
    <Section className="border-y border-linedark bg-coal2/50">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <Head eyebrow={s.eyebrow} title={s.title} copy={s.copy} />
          <Cine className="glass-strong overflow-hidden">
            {s.rows.map(([k, v], i) => (
              <div key={k} className="cine flex items-baseline justify-between gap-4 border-b border-linedark px-6 py-3.5" style={delay(i)}>
                <span className="text-[13.5px] text-ivorymuted">{k}</span>
                <span className="text-[14px] text-ivory">{v}</span>
              </div>
            ))}
            <div className="cine flex items-baseline justify-between gap-4 bg-bronze/10 px-6 py-4" style={delay(5)}>
              <span className="text-[13.5px] font-medium text-bronze">{s.total[0]}</span>
              <span className="font-display text-[24px] text-bronze">{s.total[1]}</span>
            </div>
          </Cine>
          <Cine className="mt-3">
            <p className="cine text-[11.5px] text-ivorymuted/70">{s.demoNote}</p>
          </Cine>
        </div>
        <div>
          <Cine>
            <Parallax amount={24} className="cine">
              <Shot src={MEDIA.pricing} alt="Конструктор логики цены — демонстрационный интерфейс" />
            </Parallax>
          </Cine>
          <Cine className="cine glass mt-6 p-6">
            <div className="mb-3 text-[14.5px] font-semibold text-ivory">{s.onboarding.q}</div>
            <div className="space-y-2">
              {s.onboarding.options.map((o, i) => (
                <div key={o} className="flex items-center gap-3 rounded-lg border border-linedark px-4 py-2.5 text-[13.5px] text-ivory/75">
                  <span className={`h-3.5 w-3.5 rounded-full border ${i === 0 ? "border-bronze bg-bronze" : "border-linedark"}`} aria-hidden />
                  {o}
                </div>
              ))}
            </div>
            <p className="mt-4 text-[12.5px] leading-relaxed text-ivorymuted">{s.onboarding.note}</p>
          </Cine>
        </div>
      </div>
    </Section>
  );
}

// 10. Конструктор КП
function ProposalBuilder() {
  const s = L.proposalS;
  return (
    <Section className="glow-amber">
      <Head eyebrow={s.eyebrow} title={s.title} copy={s.copy} />
      <div className="grid items-start gap-12 lg:grid-cols-2">
        <Cine>
          <Parallax amount={22} className="cine">
            <Shot src={MEDIA.proposal} alt="КП собирается из структурированных блоков — стилизованная демонстрация" />
          </Parallax>
        </Cine>
        <div>
          <Cine className="flex flex-wrap gap-2">
            {s.sections.map((sec, i) => (
              <span key={sec} className="cine rounded-lg border border-linedark bg-coal2/80 px-3.5 py-2 text-[13px] text-ivory/80" style={delay(i, 0.05)}>
                {sec}
              </span>
            ))}
          </Cine>
          <Cine className="mt-8">
            <div className="cine mb-2 text-[11px] uppercase tracking-[0.2em] text-ivorymuted">{s.statusesLabel}</div>
            <div className="cine flex flex-wrap items-center gap-2" style={delay(1)}>
              {s.statuses.map((st, i) => (
                <span key={st} className="flex items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-[12px] ${i >= 3 ? "border border-olive/40 bg-olive/10 text-olive" : "border border-linedark text-ivorymuted"}`}>
                    {st}
                  </span>
                  {i < s.statuses.length - 1 && <span aria-hidden className="text-ivorymuted/40">→</span>}
                </span>
              ))}
            </div>
          </Cine>
          <Cine className="mt-8 space-y-3">
            <p className="cine text-[14.5px] text-ivory/80">{s.clientCta}</p>
            <p className="cine text-[13px] leading-relaxed text-ivorymuted" style={delay(1)}>{s.honest}</p>
            <Link href="/demo/proposal" className="cine btn-bronze mt-2" style={delay(2)}>
              {s.cta} <span aria-hidden>→</span>
            </Link>
          </Cine>
        </div>
      </div>
    </Section>
  );
}

// 11. Опыт клиента
function ClientExperience() {
  const s = L.clientx;
  return (
    <Section>
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div className="order-2 lg:order-1">
          <Cine>
            <Parallax amount={20} className="cine">
              <Shot src={MEDIA.clientBrief} alt="Клиентский бриф с брендингом студии — демонстрационный интерфейс" />
            </Parallax>
          </Cine>
        </div>
        <div className="order-1 lg:order-2">
          <Head eyebrow={s.eyebrow} title={s.title} copy={s.copy} />
          <Cine className="space-y-2.5">
            {s.points.map((p, i) => (
              <div key={p} className="cine flex items-start gap-3 text-[14.5px] text-ivory/80" style={delay(i)}>
                <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-olive/20 text-[10px] text-olive">✓</span>
                {p}
              </div>
            ))}
          </Cine>
          <Cine className="cine glass mt-8 max-w-[420px] p-6">
            <div className="font-display mb-2 text-[20px] text-ivory">{s.finalTitle}</div>
            {s.finalLines.map((l) => (
              <p key={l} className="text-[13.5px] leading-relaxed text-ivory/65">{l}</p>
            ))}
          </Cine>
        </div>
      </div>
    </Section>
  );
}

// 12. Дизайнер владеет отношением
function Ownership() {
  const s = L.ownership;
  return (
    <Section className="border-y border-linedark bg-coal2/50">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <Head eyebrow={s.eyebrow} title={s.title} copy={s.copy} />
          <Cine className="space-y-4">
            {s.cards.map(([t, c], i) => (
              <div key={t} className="cine rounded-xl border border-linedark bg-coal/60 p-5" style={delay(i)}>
                <div className="mb-1.5 text-[14.5px] font-semibold text-ivory">{t}</div>
                <p className="text-[13px] leading-relaxed text-ivory/60">{c}</p>
              </div>
            ))}
          </Cine>
          <Cine className="mt-8">
            <p className="cine font-display text-[24px] italic leading-snug text-bronze">{s.trust}</p>
          </Cine>
        </div>
        <Cine>
          <Parallax amount={26} className="cine">
            <Shot src={MEDIA.ownership} alt="Одна ссылка на бриф — одна студия: без маркетплейса" />
          </Parallax>
        </Cine>
      </div>
    </Section>
  );
}

// 13. Данные
function DataSafety() {
  const s = L.safety;
  return (
    <Section id="safety" className="glow-amber">
      <div className="grid items-start gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <Head eyebrow={s.eyebrow} title={s.title} />
          <Cine className="grid gap-4 sm:grid-cols-2">
            {s.cards.map(([t, c], i) => (
              <div key={t} className="cine glass p-6" style={delay(i)}>
                <div className="mb-2 text-[14.5px] font-semibold text-ivory">{t}</div>
                <p className="text-[13px] leading-relaxed text-ivory/60">{c}</p>
              </div>
            ))}
          </Cine>
          <Cine className="mt-6">
            <p className="cine max-w-[70ch] text-[13px] leading-relaxed text-ivorymuted">{s.note}</p>
            <Link href="/security" className="cine mt-4 inline-flex items-center gap-2 text-[14.5px] text-bronze underline-offset-4 hover:underline" style={delay(1)}>
              {s.cta} <span aria-hidden>→</span>
            </Link>
          </Cine>
        </div>
        <Cine>
          <Parallax amount={24} className="cine">
            <Shot src={MEDIA.safety} alt="Данные клиента собраны в одном рабочем пространстве студии" ratio="aspect-[16/10]" />
          </Parallax>
        </Cine>
      </div>
    </Section>
  );
}

// 14. Что создаёт ARHIDOM
function WhatItCreates() {
  const s = L.creates;
  return (
    <Section>
      <Head eyebrow={s.eyebrow} title={s.title} center />
      <Cine className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        {s.cats.map((cat, i) => (
          <div key={cat.title} className="cine glass p-6 transition-colors hover:border-bronze/40" style={delay(i)}>
            <div className="font-display mb-4 text-[20px] font-semibold text-ivory">{cat.title}</div>
            <div className="flex flex-wrap gap-1.5">
              {cat.items.map((it) => (
                <span key={it} className="rounded-md border border-linedark px-2 py-1 text-[11.5px] text-ivory/60">
                  {it}
                </span>
              ))}
            </div>
          </div>
        ))}
      </Cine>
    </Section>
  );
}

// 15. Повестка первой встречи
function MeetingAgenda() {
  const s = L.agenda;
  return (
    <Section className="border-y border-linedark bg-coal2/50">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <Cine>
          <Parallax amount={24} className="cine">
            <Shot src={MEDIA.agenda} alt="Повестка первой встречи — карточки вопросов" />
          </Parallax>
        </Cine>
        <div>
          <Head eyebrow={s.eyebrow} title={s.title} copy={s.copy} />
          <Cine className="space-y-2">
            {s.items.map((it, i) => (
              <div key={it} className="cine flex items-center gap-3 rounded-lg border border-linedark bg-coal/60 px-4 py-3 text-[14px] text-ivory/80" style={delay(i, 0.06)}>
                <span className="font-display text-[15px] text-bronze/80">{String(i + 1).padStart(2, "0")}</span>
                {it}
              </div>
            ))}
          </Cine>
          <Cine className="mt-7">
            <Link href="/demo" className="cine inline-flex items-center gap-2 text-[14.5px] text-bronze underline-offset-4 hover:underline">
              {s.cta} <span aria-hidden>→</span>
            </Link>
          </Cine>
        </div>
      </div>
    </Section>
  );
}

// 16. Сравнение
function Comparison() {
  const s = L.compare;
  return (
    <Section>
      <Head eyebrow={s.eyebrow} title={s.title} center />
      <div className="mx-auto max-w-[980px] space-y-3">
        {s.rows.map(([who, problem, ours], i) => (
          <Cine key={who}>
            <div className="cine grid gap-3 rounded-xl border border-linedark bg-coal2/70 p-5 md:grid-cols-[180px_1fr_1fr] md:gap-6 md:p-6" style={delay(i % 3, 0.07)}>
              <div className="font-display text-[18px] font-semibold leading-tight text-ivory">{who}</div>
              <div>
                <div className="mb-1 text-[10.5px] uppercase tracking-[0.16em] text-ivorymuted/70 md:hidden">{s.colProblem}</div>
                <p className="text-[13.5px] leading-relaxed text-ivory/55">{problem}</p>
              </div>
              <div className="border-linedark md:border-l md:pl-6">
                <div className="mb-1 text-[10.5px] uppercase tracking-[0.16em] text-bronze/80">{s.colOurs}</div>
                <p className="text-[13.5px] leading-relaxed text-ivory/85">{ours}</p>
              </div>
            </div>
          </Cine>
        ))}
      </div>
    </Section>
  );
}

// 17. Фокус (что мы — не)
function NotThis() {
  const s = L.notthis;
  return (
    <Section className="glow-amber">
      <Head eyebrow={s.eyebrow} title={s.title} center />
      <Cine className="mx-auto grid max-w-[980px] gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {s.cards.map(([t, c], i) => (
          <div key={t} className="cine rounded-xl border border-linedark bg-coal2/60 p-5" style={delay(i, 0.06)}>
            <div className="mb-1.5 text-[14px] font-semibold text-ivory/90">{t}</div>
            <p className="text-[12.5px] leading-relaxed text-ivory/55">{c}</p>
          </div>
        ))}
      </Cine>
    </Section>
  );
}

// 18. Финальный CTA
function FinalCta() {
  const s = L.cta;
  return (
    <Section className="relative overflow-hidden">
      <div className="grid-arch absolute inset-0 opacity-50" aria-hidden />
      <div className="glow-amber absolute inset-0" aria-hidden />
      <div className="relative mx-auto max-w-[900px] text-center">
        <Cine>
          <div className="cine mx-auto mb-10 flex flex-wrap items-center justify-center gap-2.5">
            {s.orbit.map((o, i) => (
              <span
                key={o}
                className="float-slow rounded-full border border-bronze/30 bg-coal2/80 px-4 py-1.5 text-[12.5px] text-bronze/90"
                style={{ ...delay(i, 0.9), "--r": `${(i % 2 ? 1 : -1) * 0.8}deg` } as React.CSSProperties}
              >
                {o}
              </span>
            ))}
          </div>
          <h2 className="cine font-display text-[clamp(34px,5vw,64px)] font-semibold leading-[1.04] text-ivory" style={delay(1)}>
            {s.title}
          </h2>
          <p className="cine mx-auto mt-6 max-w-[62ch] text-[15.5px] leading-relaxed text-ivory/70" style={delay(2)}>
            {s.sub}
          </p>
          <div className="cine mt-10 flex flex-wrap items-center justify-center gap-3" style={delay(3)}>
            <Link href="/demo/brief" className="btn-bronze">
              {s.c1} <span aria-hidden>→</span>
            </Link>
            <Link href="/login" className="btn-dark-ghost">
              {s.c2}
            </Link>
            <Link href="/demo/proposal" className="inline-flex min-h-12 items-center px-2 text-[15px] text-ivorymuted underline-offset-4 hover:text-ivory hover:underline">
              {s.c3}
            </Link>
          </div>
          <p className="cine mt-8 text-[12.5px] tracking-wide text-ivorymuted" style={delay(4)}>
            {s.trust}
          </p>
        </Cine>
      </div>
    </Section>
  );
}
