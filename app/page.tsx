import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import Reveal from "@/components/reveal";
import StartClientBrief from "./start-client-brief";

const h = ru.home;

// Картинки лендинга сгенерированы (Higgsfield) и хостятся на CDN.
const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3EKntK4EDjG8nay4H1dy1TK30mB";
const IMAGES = {
  hero: `${CDN}/hf_20260703_060804_2eaedd7c-c4fd-4322-a2be-8bd5cf1e3c3b.png`,
  before: `${CDN}/hf_20260703_061031_e3113877-b81b-42cf-a0cf-3826895023ef.png`,
  after: `${CDN}/hf_20260703_061053_995c6a8f-96ce-4228-9ee0-20781ac42918.png`,
  portrait: `${CDN}/hf_20260703_061105_084022de-7e46-4b47-a211-2d1b5e333399.png`,
  heroVideo: `${CDN}/hf_20260703_072328_a3a141b9-6adf-4351-8ac9-e993b8bed680.mp4`,
};

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Шапка */}
      <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1120px] items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-baseline gap-3">
            <span className="font-display text-2xl font-semibold leading-none">{ru.app.name}</span>
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted">{ru.app.tagline}</span>
          </Link>
          <Link href="/login" className="text-sm text-muted hover:text-ink">
            Войти
          </Link>
        </div>
      </header>

      {/* Hero */}
      <Reveal>
        <section className="mx-auto max-w-[1120px] px-6 pb-12 pt-[clamp(56px,9vw,110px)]">
          <div className="mb-6 text-[13px] uppercase tracking-[0.16em] text-muted">{h.eyebrow}</div>
          <h1 className="font-display max-w-[16ch] text-[clamp(38px,6.2vw,64px)] font-semibold leading-[1.04] tracking-[-0.5px]">
            {ru.app.hero}
          </h1>
          <p className="mt-6 max-w-[52ch] text-[clamp(17px,2vw,20px)] leading-relaxed text-muted">
            {ru.app.heroSub}
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/login" className="btn bg-accent px-6 py-3.5 text-base text-white hover:bg-accent/90">
              Открыть кабинет дизайнера <span className="ml-2">→</span>
            </Link>
            <StartClientBrief label="Посмотреть бриф глазами клиента" variant="outline" />
          </div>
        </section>
      </Reveal>

      {/* Обложка */}
      <Reveal>
        <section className="mx-auto max-w-[1120px] px-6 pb-9">
          <video
            autoPlay
            muted
            loop
            playsInline
            poster={IMAGES.hero}
            className="h-[clamp(280px,42vw,520px)] w-full rounded-xl border border-line object-cover"
          >
            <source src={IMAGES.heroVideo} type="video/mp4" />
          </video>
        </section>
      </Reveal>

      {/* Развилка */}
      <Reveal>
        <section className="mx-auto grid max-w-[1120px] gap-5 px-6 py-11 md:grid-cols-2">
          <ForkCard
            color="accent"
            eyebrow={h.designerTitle}
            head={h.designerHead}
            desc={h.designerDesc}
            cta={<Link href="/login" className="btn self-start bg-accent px-5 py-3 text-white hover:bg-accent/90">{h.designerCta} <span className="ml-2">→</span></Link>}
          />
          <ForkCard
            color="clientaccent"
            eyebrow={h.clientTitle}
            head={h.clientHead}
            desc={h.clientDesc}
            cta={<StartClientBrief label={h.clientCta} variant="cli" />}
          />
        </section>
      </Reveal>

      {/* Как это работает */}
      <Reveal>
        <section className="mx-auto max-w-[1120px] px-6 pb-6 pt-[clamp(50px,8vw,90px)]">
          <div className="mb-3.5 text-[13px] uppercase tracking-[0.16em] text-muted">Как это работает</div>
          <h2 className="font-display mb-11 max-w-[20ch] text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.08]">
            Три шага от переписки до предложения
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            <Step n="01" title="Бриф" desc="Клиент отвечает на один вопрос за раз. Крупно, спокойно, по-человечески.">
              <div className="card bg-paper">
                <div className="mb-4 flex gap-1.5">
                  <Bar on /><Bar on /><Bar /><Bar />
                </div>
                <div className="font-display mb-4 text-xl leading-tight">Как проходит обычный вечер дома?</div>
                <div className="rounded-md border border-line px-3 py-2.5 text-[13px] text-muted">Готовим вместе, потом кино…</div>
              </div>
            </Step>
            <Step n="02" title="Паспорт и риски" desc="Система собирает паспорт проекта и подсвечивает противоречия до встречи.">
              <div className="card bg-paper">
                <div className="flex justify-between border-b border-line pb-2.5 text-xs text-muted"><span>Площадь</span><span className="text-ink">120 м²</span></div>
                <div className="flex justify-between pb-3 pt-2.5 text-xs text-muted"><span>Бюджет</span><span className="text-ink">2 000 000 ₽</span></div>
                <div className="rounded-md border border-line border-l-[3px] border-l-accent bg-[#f6f5f0] px-3 py-2.5">
                  <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-accent">Риск · деньги</div>
                  <div className="text-xs text-ink">Бюджет не согласуется с площадью</div>
                </div>
              </div>
            </Step>
            <Step n="03" title="КП" desc="Собранное предложение с этапами и вилкой цены — готово к отправке.">
              <div className="card bg-paper">
                <div className="font-display mb-3.5 text-lg">Коммерческое предложение</div>
                <div className="mb-2 h-1.5 w-[90%] rounded bg-[#eceae4]" />
                <div className="mb-2 h-1.5 w-[75%] rounded bg-[#eceae4]" />
                <div className="mb-4 h-1.5 w-[82%] rounded bg-[#eceae4]" />
                <div className="flex items-baseline justify-between border-t border-line pt-3">
                  <span className="text-xs text-muted">Итого, вилка</span>
                  <span className="font-display text-xl text-accent">3,4–4,1 млн ₽</span>
                </div>
              </div>
            </Step>
          </div>
        </section>
      </Reveal>

      {/* Из сумбура в структуру */}
      <Reveal>
        <section className="mx-auto max-w-[1120px] px-6 py-[clamp(50px,8vw,90px)]">
          <div className="mb-3.5 text-[13px] uppercase tracking-[0.16em] text-muted">Живой пример</div>
          <h2 className="font-display mb-3 max-w-[20ch] text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.08]">
            Из сумбура — в структуру
          </h2>
          <p className="mb-10 max-w-[56ch] leading-relaxed text-muted">
            Клиент говорит как умеет. Свод превращает свободный рассказ в бриф, с которым можно работать и считать.
          </p>
          <div className="grid items-start gap-5 md:grid-cols-2">
            <div className="rounded-2xl rounded-tl-md border border-clientaccent/25 bg-clientaccent/5 px-7 py-6">
              <div className="mb-4 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-clientaccent">Как клиент описал</div>
              <p className="font-display text-[clamp(19px,2.4vw,23px)] font-medium leading-[1.45]">
                «Ну хотим квартиру, чтобы уютно, но не как у всех. Свет прям очень важен — я по утрам работаю из дома. Кухня большая обязательно, любим готовить и звать гостей. Ребёнку нужна своя комната. Бюджет… ну миллиона два, наверное? И въехать бы к осени.»
              </p>
            </div>
            <div className="card">
              <div className="mb-4 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-accent">Что понял Свод</div>
              {[
                ["Объект", "Квартира"],
                ["Приоритет №1", "Естественный свет · домашний офис"],
                ["Кухня", "Большая · готовим и зовём гостей"],
                ["Комнаты", "Отдельная детская"],
                ["Бюджет", "~2 000 000 ₽ · уточнить"],
                ["Сроки", "Въезд к осени"],
              ].map(([k, v], i, arr) => (
                <div key={k} className={`flex justify-between gap-4 py-2.5 text-[15px] ${i < arr.length - 1 ? "border-b border-[#f0eee8]" : ""}`}>
                  <span className="text-muted">{k}</span>
                  <span className="text-right">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </Reveal>

      {/* До / после */}
      <Reveal>
        <section className="mx-auto max-w-[1120px] px-6 py-[clamp(50px,8vw,90px)]">
          <div className="mb-3.5 text-[13px] uppercase tracking-[0.16em] text-muted">Портфолио</div>
          <h2 className="font-display mb-10 max-w-[22ch] text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.08]">
            До и после — язык, который клиент понимает без слов
          </h2>
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">До</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={IMAGES.before}
                alt="До ремонта"
                loading="lazy"
                className="h-[clamp(240px,30vw,380px)] w-full rounded-xl border border-line object-cover"
              />
            </div>
            <div>
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-accent">После</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={IMAGES.after}
                alt="После ремонта"
                loading="lazy"
                className="h-[clamp(240px,30vw,380px)] w-full rounded-xl border border-line object-cover"
              />
            </div>
          </div>
        </section>
      </Reveal>

      {/* Доказательство — карточка риска */}
      <Reveal>
        <section className="mx-auto max-w-[1120px] px-6 py-[clamp(50px,8vw,90px)]">
          <div className="grid items-center gap-[clamp(28px,5vw,56px)] rounded-2xl border border-line bg-[#f6f5f0] p-[clamp(28px,5vw,56px)] md:grid-cols-2">
            <div>
              <div className="mb-4 text-[13px] uppercase tracking-[0.16em] text-muted">Оно думает за вас</div>
              <h2 className="font-display mb-4 text-[clamp(28px,4vw,40px)] font-semibold leading-[1.1]">
                Ловит противоречия, которые всплыли бы на монтаже
              </h2>
              <p className="leading-relaxed text-muted">
                Каждая карточка помечена источником: жёсткое правило или гипотеза системы. Вы решаете, что принять.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-paper p-6 shadow-[0_12px_40px_-24px_rgba(26,26,26,0.28)]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Риск · деньги</span>
                <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">Правило · высокая уверенность</span>
              </div>
              <p className="font-display mb-3.5 text-[23px] leading-[1.28]">
                Бюджет 2 000 000 ₽ противоречит площади 120 м² — уточните вилку.
              </p>
              <p className="mb-5 text-sm leading-relaxed text-muted">
                Средняя стоимость реализации в этом сегменте — 28–34 тыс ₽/м². Реалистичная вилка: 3,4–4,1 млн ₽.
              </p>
              <div className="flex gap-2.5">
                <span className="btn flex-1 bg-accent text-white">Принять</span>
                <span className="btn flex-1 border border-line bg-white text-ink">Отклонить</span>
              </div>
            </div>
          </div>
        </section>
      </Reveal>

      {/* Отзыв + футер */}
      <Reveal>
        <section className="mx-auto max-w-[1120px] px-6 pb-[clamp(60px,9vw,110px)]">
          <div className="mb-[clamp(44px,7vw,76px)] grid items-center gap-[clamp(28px,5vw,56px)] md:grid-cols-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={IMAGES.portrait}
              alt="Дизайнер"
              loading="lazy"
              className="h-[clamp(280px,34vw,380px)] w-full rounded-xl border border-line object-cover"
            />
            <div>
              <div className="mb-5 text-xs font-semibold uppercase tracking-[0.16em] text-accent">Дизайнеры о «Своде»</div>
              <p className="font-display mb-5 text-[clamp(24px,3.2vw,33px)] font-medium leading-[1.3]">
                «Клиент приходит на встречу, уже понимая вилку цены. Мы обсуждаем проект, а не выбиваем бюджет.»
              </p>
              <div className="text-[15px] font-semibold">Анна Ковалёва</div>
              <div className="text-sm text-muted">Дизайн-бюро «Формула», Москва</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-7">
            <p className="m-0 max-w-[64ch] text-sm leading-relaxed text-muted">{h.trust}</p>
            <span className="font-display text-[22px]">{ru.app.name}</span>
          </div>
        </section>
      </Reveal>
    </div>
  );
}

function ForkCard({
  color,
  eyebrow,
  head,
  desc,
  cta,
}: {
  color: "accent" | "clientaccent";
  eyebrow: string;
  head: string;
  desc: string;
  cta: React.ReactNode;
}) {
  const bar = color === "accent" ? "bg-accent" : "bg-clientaccent";
  const text = color === "accent" ? "text-accent" : "text-clientaccent";
  return (
    <div className="relative flex flex-col overflow-hidden rounded-xl border border-line bg-paper px-8 py-9">
      <div className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <div className={`mb-4 text-xs font-semibold uppercase tracking-[0.16em] ${text}`}>{eyebrow}</div>
      <h3 className="font-display mb-3 text-[30px] font-semibold leading-[1.1]">{head}</h3>
      <p className="mb-6 flex-1 text-[15.5px] leading-relaxed text-muted">{desc}</p>
      {cta}
    </div>
  );
}

function Step({ n, title, desc, children }: { n: string; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-4 flex items-baseline gap-3">
        <span className="font-display text-[34px] leading-none text-accent">{n}</span>
        <span className="text-[17px] font-semibold">{title}</span>
      </div>
      <p className="mb-5 min-h-[44px] text-[14.5px] leading-relaxed text-muted">{desc}</p>
      {children}
    </div>
  );
}

function Bar({ on = false }: { on?: boolean }) {
  return <div className={`h-1 flex-1 rounded-full ${on ? "bg-clientaccent" : "bg-line"}`} />;
}
