import Link from "next/link";
import { ru } from "@/lib/i18n/ru";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6">
      <p className="text-sm uppercase tracking-widest text-muted">{ru.app.name}</p>
      <h1 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">{ru.app.tagline}</h1>
      <div className="mt-8">
        <Link href="/login" className="btn-primary">
          {ru.auth.title}
        </Link>
      </div>
    </main>
  );
}
