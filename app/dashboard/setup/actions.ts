"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStudio } from "@/lib/studio";
import type { PricingConfig, ProposalDefaults, DesignerProfile } from "@/lib/types";

export interface SetupPayload {
  name: string;
  studio_name: string;
  pricing: PricingConfig | null; // null → режим «без цены»
  proposal_defaults: ProposalDefaults;
  profile: DesignerProfile;
}

export async function saveSetup(payload: SetupPayload): Promise<{ ok: boolean }> {
  const studio = await getStudio();
  if (!studio) return { ok: false };

  const supabase = await createClient();
  // Правим профиль СТУДИИ (владельца). RLS разрешает участникам (равный доступ).
  const { error } = await supabase
    .from("designers")
    .update({
      name: payload.name,
      studio_name: payload.studio_name,
      pricing: payload.pricing,
      proposal_defaults: payload.proposal_defaults,
      profile: payload.profile,
    })
    .eq("id", studio.studioId);

  if (!error) revalidatePath("/dashboard/setup");
  return { ok: !error };
}

// ── Команда (v1) ─────────────────────────────────────────────

export async function inviteMember(emailRaw: string): Promise<{ ok: boolean; error?: string }> {
  const studio = await getStudio();
  if (!studio) return { ok: false, error: "unauthorized" };
  if (studio.role !== "owner") return { ok: false, error: "Приглашать может только владелец." };

  const email = emailRaw.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "Введите корректный email." };
  }
  if (email === studio.email) return { ok: false, error: "Это ваш собственный email." };

  const supabase = await createClient();
  const { error } = await supabase.from("studio_members").insert({
    owner_id: studio.studioId,
    email,
    status: "invited",
  });

  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      return { ok: false, error: "Этот email уже в команде." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/dashboard/setup");
  return { ok: true };
}

export async function removeMember(id: string): Promise<{ ok: boolean }> {
  // RLS: удалить может только владелец студии.
  const supabase = await createClient();
  const { error } = await supabase.from("studio_members").delete().eq("id", id);
  if (!error) revalidatePath("/dashboard/setup");
  return { ok: !error };
}
