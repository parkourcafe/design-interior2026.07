import Link from "next/link";
import { ru } from "@/lib/i18n/ru";

export default function NotFound() {
  return (
    <main className="landing flex min-h-screen items-center justify-center px-6 py-20 text-center">
      <div className="glass-strong w-full max-w-xl p-8 sm:p-12">
        <p className="text-[14px] uppercase tracking-[0.2em] text-bronze">Ошибка 404</p>
        <h1 className="mt-4 font-display text-[42px] font-semibold text-ivory">{ru.common.notFound}</h1>
        <p className="mx-auto mt-4 max-w-[42ch] text-[18px] leading-relaxed text-ivory/80">
          Такой страницы нет. Вернитесь к RemHaOS или откройте рабочую демонстрацию продукта.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/" className="btn-bronze">На главную</Link>
          <Link href="/demo" className="btn-dark-ghost">Посмотреть демо</Link>
          <Link href="/demo/brief" className="btn-dark-ghost">Пройти бриф</Link>
        </div>
      </div>
    </main>
  );
}
