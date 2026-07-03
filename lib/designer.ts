import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PricingConfig, ProposalDefaults, DesignerProfile } from "@/lib/types";

export interface DesignerRow {
  id: string;
  name: string;
  studio_name: string;
  pricing: PricingConfig | null;
  proposal_defaults: ProposalDefaults;
  profile: DesignerProfile;
}

const SELECT = "id, name, studio_name, pricing, proposal_defaults, profile";

// Возвращает текущего залогиненного дизайнера, создавая строку при первом входе.
export async function getOrCreateDesigner(): Promise<DesignerRow | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: existing } = await supabase
    .from("designers")
    .select(SELECT)
    .eq("id", user.id)
    .maybeSingle();

  if (existing) return existing as DesignerRow;

  const seed = {
    id: user.id,
    name: "",
    studio_name: "",
    pricing: null,
    proposal_defaults: { exclusions: [], revision_limit: 2, stage_completion: "" },
    profile: {},
  };
  const { data: created } = await supabase.from("designers").insert(seed).select(SELECT).single();
  return (created as DesignerRow) ?? (seed as DesignerRow);
}

export interface DesignerPublic {
  name: string;
  studio_name: string;
  profile: DesignerProfile;
}

// Публичные данные дизайнера для показа клиенту на брифе (service role, без сессии).
export async function getDesignerPublic(designerId: string): Promise<DesignerPublic | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("designers")
    .select("name, studio_name, profile")
    .eq("id", designerId)
    .maybeSingle();
  if (!data) return null;
  return {
    name: (data as { name?: string }).name ?? "",
    studio_name: (data as { studio_name?: string }).studio_name ?? "",
    profile: ((data as { profile?: DesignerProfile }).profile ?? {}) as DesignerProfile,
  };
}
