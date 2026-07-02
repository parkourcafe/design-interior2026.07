import Link from "next/link";
import { ru } from "@/lib/i18n/ru";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold">{ru.common.notFound}</h1>
      <Link href="/" className="btn-ghost mt-6 w-fit self-center">
        ← {ru.app.name}
      </Link>
    </main>
  );
}
