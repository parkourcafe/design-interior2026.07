import Link from "next/link";
import { ru } from "@/lib/i18n/ru";

const copy = ru.projectCeo.identityUnverified;

// ТЗ 08.10, FIX-04 D8: отказ identity_unverified остаётся отказом — данных
// проекта здесь нет, — но человеку объяснён доступный ему законный шаг.
export function ProjectCeoIdentityUnverified() {
  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-orange-200 bg-orange-50 p-6" data-testid="identity-unverified">
      <h1 className="font-display text-2xl font-semibold">{copy.title}</h1>
      <p className="mt-3 text-sm leading-6">{copy.text}</p>
      <p className="mt-3 text-sm leading-6">{copy.step}</p>
      <Link href="/login" className="btn-primary mt-5 inline-flex">{copy.signIn}</Link>
    </section>
  );
}
