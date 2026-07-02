"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { PricingConfig, ProposalDefaults } from "@/lib/types";

export interface SetupPayload {
  name: string;
  studio_name: string;
  pricing: PricingConfig | null; // null → режим «без цены»
  proposal_defaults: ProposalDefaults;
}

export async function saveSetup(payload: SetupPayload): Promise<{ ok: boolean }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase
    .from("designers")
    .update({
      name: payload.name,
      studio_name: payload.studio_name,
      pricing: payload.pricing,
      proposal_defaults: payload.proposal_defaults,
    })
    .eq("id", user.id);

  if (!error) revalidatePath("/dashboard/setup");
  return { ok: !error };
}
