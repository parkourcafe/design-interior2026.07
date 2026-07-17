"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Активация приглашения по ссылке-токену. Доступ к студии даётся ТОЛЬКО здесь —
// залогиненный человек, владеющий ссылкой, становится участником. Токен
// одноразовый (гаснет после входа) и с истечением (см. миграцию 0007).
export async function acceptInvite(
  token: string,
): Promise<{ ok: boolean; error?: "unauthorized" | "invalid" | "failed" }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("studio_members")
    .select("id, owner_id, status, token_expires_at")
    .eq("invite_token", token)
    .maybeSingle();

  const inv = invite as
    | { id: string; owner_id: string; status: string; token_expires_at: string | null }
    | null;

  if (!inv || inv.status !== "invited") return { ok: false, error: "invalid" };
  if (inv.token_expires_at && new Date(inv.token_expires_at).getTime() < Date.now()) {
    return { ok: false, error: "invalid" };
  }

  // Гасим токен в этой же операции: ссылка одноразовая.
  const { error } = await admin
    .from("studio_members")
    .update({
      member_id: user.id,
      status: "active",
      joined_at: new Date().toISOString(),
      invite_token: null,
      token_expires_at: null,
    })
    .eq("id", inv.id)
    .eq("status", "invited"); // защита от гонки: активируем только всё ещё «invited»

  if (error) return { ok: false, error: "failed" };
  return { ok: true };
}
