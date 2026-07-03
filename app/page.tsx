import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import StartClientBrief from "./start-client-brief";

const h = ru.home;

function Check({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`h-4 w-4 shrink-0 ${className}`} aria-hidden>
      <path d="M4 10.5l3.5 3.5L16 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DesignerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
      <rect x="3" y="7" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ClientIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
      <path d="M4 11l8-6 8 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10v9h12v-9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
        {/* Hero */}
        <div className="text-center">
          <span className="inline-block rounded-full border border-line bg-white px-3 py-1 text-xs font-medium tracking-wide text-muted">
            {h.eyebrow}
          </span>
          <h1 className="mx-auto mt-5 max-w-3xl text-3xl font-semibold leading-tight sm:text-5xl">
            {h.heroTitle}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-ink/70 sm:text-lg">{h.heroSub}</p>
        </div>

        {/* Две панели */}
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Дизайнер */}
          <section className="group flex flex-col rounded-2xl border border-line border-t-4 border-t-accent bg-white p-7 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
            <div className="flex items-center gap-3 text-accent">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10">
                <DesignerIcon />
              </span>
              <h2 className="text-xl font-semibold">{h.designerTitle}</h2>
            </div>
            <p className="mt-4 text-sm text-ink/70">{h.designerDesc}</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              {h.designerBullets.map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <Check className="mt-0.5 text-accent" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <Link href="/login" className="btn mt-6 w-full bg-accent text-white hover:bg-accent/90">
              {h.designerCta}
            </Link>
          </section>

          {/* Клиент */}
          <section className="group flex flex-col rounded-2xl border border-line border-t-4 border-t-clientaccent bg-white p-7 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
            <div className="flex items-center gap-3 text-clientaccent">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-clientaccent/10">
                <ClientIcon />
              </span>
              <h2 className="text-xl font-semibold">{h.clientTitle}</h2>
            </div>
            <p className="mt-4 text-sm text-ink/70">{h.clientDesc}</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              {h.clientBullets.map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <Check className="mt-0.5 text-clientaccent" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <StartClientBrief />
          </section>
        </div>

        {/* Мок карточки риска — показываем продукт */}
        <div className="mt-12">
          <p className="text-center text-xs uppercase tracking-widest text-muted">{h.sampleCaption}</p>
          <div className="mx-auto mt-4 max-w-md rounded-xl border border-line bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
                Бюджет
              </span>
              <span className="text-xs text-muted">уверенность: высокая · AI</span>
            </div>
            <p className="mt-3 text-sm">
              <span className="text-muted">Возможный риск. </span>
              Натуральный камень при экономном бюджете — итоговая смета вырастет.
            </p>
            <p className="mt-3 text-xs uppercase tracking-wide text-muted">Рекомендуем обсудить</p>
            <p className="mt-0.5 text-sm">
              Где камень критичен, а где подойдёт керамогранит или акцентное использование.
            </p>
            <div className="mt-4 flex gap-2">
              <span className="btn bg-accent px-3 py-1.5 text-xs text-white">Принять</span>
              <span className="btn border border-line px-3 py-1.5 text-xs text-ink">Отклонить</span>
            </div>
          </div>
        </div>

        {/* Строка доверия */}
        <p className="mt-10 text-center text-xs text-muted">{h.trust}</p>
      </div>
    </main>
  );
}
