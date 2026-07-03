import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import StartClientBrief from "./start-client-brief";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="px-6 pt-10 text-center">
        <p className="text-sm uppercase tracking-widest text-muted">{ru.app.name}</p>
        <h1 className="mx-auto mt-3 max-w-2xl text-2xl font-semibold leading-tight sm:text-3xl">
          {ru.app.tagline}
        </h1>
      </header>

      <div className="mx-auto grid w-full max-w-4xl flex-1 grid-cols-1 gap-4 p-6 md:grid-cols-2">
        {/* Панель дизайнера */}
        <section className="flex flex-col rounded-xl border border-accent/30 bg-accent/5 p-7">
          <h2 className="text-xl font-semibold text-accent">{ru.home.designerTitle}</h2>
          <p className="mt-3 flex-1 text-sm text-ink/80">{ru.home.designerDesc}</p>
          <Link
            href="/login"
            className="btn mt-6 bg-accent text-white hover:bg-accent/90"
          >
            {ru.home.designerCta}
          </Link>
        </section>

        {/* Панель клиента — равная по значимости, другой цвет */}
        <section className="flex flex-col rounded-xl border border-clientaccent/30 bg-clientaccent/5 p-7">
          <h2 className="text-xl font-semibold text-clientaccent">{ru.home.clientTitle}</h2>
          <p className="mt-3 flex-1 text-sm text-ink/80">{ru.home.clientDesc}</p>
          <StartClientBrief />
        </section>
      </div>
    </main>
  );
}
