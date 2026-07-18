import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ru } from "@/lib/i18n/ru";
import JoinButton from "./join-button";

export const dynamic = "force-dynamic";

// Приглашение в студию по ссылке-токену. Доступ активируется только явным
// нажатием (server action), не побочным эффектом загрузки страницы.
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const j = ru.join;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Не проверяем существование токена сырым клиентом: читаем метаданные
  // service-role'ом только чтобы показать имя студии и валидность ссылки.
  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("studio_members")
    .select("owner_id, status, token_expires_at")
    .eq("invite_token", token)
    .maybeSingle();

  const inv = invite as
    | { owner_id: string; status: string; token_expires_at: string | null }
    | null;
  const expired = Boolean(
    inv?.token_expires_at && new Date(inv.token_expires_at).getTime() < Date.now(),
  );
  const valid = Boolean(inv && inv.status === "invited" && !expired);

  let studioName = "";
  if (valid && inv) {
    const { data: owner } = await admin
      .from("designers")
      .select("studio_name, name")
      .eq("id", inv.owner_id)
      .maybeSingle();
    const o = owner as { studio_name?: string; name?: string } | null;
    studioName = (o?.studio_name || o?.name || "").trim();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <div className="card">
        <h1 className="font-display text-2xl font-semibold">{j.title}</h1>

        {!valid ? (
          <p className="mt-3 text-sm text-muted">{j.invalid}</p>
        ) : !user ? (
          <>
            <p className="mt-3 text-sm text-muted">
              {studioName ? j.invitedToNamed(studioName) : j.invitedTo}
            </p>
            <p className="mt-2 text-sm text-muted">{j.loginFirst}</p>
            <Link
              href={`/login?next=${encodeURIComponent(`/join/${token}`)}`}
              className="btn-primary mt-4 inline-flex"
            >
              {j.loginCta}
            </Link>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-muted">
              {studioName ? j.invitedToNamed(studioName) : j.invitedTo}
            </p>
            <JoinButton token={token} />
          </>
        )}
      </div>
    </main>
  );
}
