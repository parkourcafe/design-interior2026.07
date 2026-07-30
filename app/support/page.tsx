import type { Metadata } from "next";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import { supportEmail } from "@/lib/env";

const email = supportEmail();

export const metadata: Metadata = {
  title: `Поддержка — ${ru.app.name}`,
  description: "Помощь пользователям RemHaOS и управление данными аккаунта.",
};

export default function SupportPage() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-16">
      <Link href="/" className="text-sm text-muted hover:text-ink">← {ru.app.name}</Link>
      <h1 className="mt-8 font-display text-4xl font-semibold">Поддержка</h1>
      <p className="mt-5 leading-relaxed text-muted">
        Если у вас не открывается бриф, не получается войти или требуется помощь с данными аккаунта, напишите нам. Обычно мы отвечаем в течение двух рабочих дней.
      </p>
      <a className="btn-primary mt-6 inline-flex" href={`mailto:${email}`}>{email}</a>
      <section className="mt-12 border-t border-line pt-8">
        <h2 className="font-display text-2xl font-semibold">Удаление аккаунта и данных</h2>
        <p className="mt-3 leading-relaxed text-muted">
          Войдите в RemHaOS и откройте «Настройки» → «Удаление аккаунта». После подтверждения вход блокируется, а профиль, контакты, файлы и редактируемое содержание проектов удаляются или обезличиваются без возможности восстановления. Сохраняются только псевдонимные технические ключи и обязательный неизменяемый аудит истории проекта. Если войти не получается, напишите в поддержку с адреса, использованного при регистрации.
        </p>
      </section>
      <div className="mt-10 flex gap-5 text-sm">
        <Link href="/legal/privacy" className="underline">Политика конфиденциальности</Link>
        <Link href="/legal/terms" className="underline">Условия использования</Link>
      </div>
    </main>
  );
}
