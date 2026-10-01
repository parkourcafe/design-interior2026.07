import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supportEmail } from "@/lib/env";
import { ru } from "@/lib/i18n/ru";
import SignOutButton from "../dashboard/sign-out-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

// DEC-047: удаление аккаунта запрошено — кабинет закрыт, данные будут
// уничтожены не позднее даты purgeAfter. Сюда ведут proxy.ts и layout кабинета.
export default async function AccountClosedPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data } = await supabase.rpc("get_account_retention_status");
  const retention = data as { status?: string; purgeAfter?: string; closed?: boolean } | null;
  const closed = retention?.closed === true || retention?.status === "expired";
  if (!closed || !retention?.purgeAfter) redirect("/dashboard");
  const date = new Date(retention.purgeAfter).toLocaleDateString("ru-RU", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <main className="mx-auto min-h-screen max-w-xl px-6 py-16">
      <h1 className="font-display text-2xl font-semibold">{ru.retention.closedTitle}</h1>
      <p className="mt-4 text-sm leading-relaxed">{ru.retention.closedBody(date)}</p>
      <p className="mt-4 text-sm">
        {ru.retention.closedSupport}{" "}
        <a className="underline" href={`mailto:${supportEmail()}`}>{supportEmail()}</a>
      </p>
      <div className="mt-6"><SignOutButton /></div>
    </main>
  );
}
