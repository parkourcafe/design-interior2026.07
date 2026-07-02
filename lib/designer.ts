import { createClient } from "@/lib/supabase/server";
import type { PricingConfig, ProposalDefaults } from "@/lib/types";

export interface DesignerRow {
  id: string;
  name: string;
  studio_name: string;
  pricing: PricingConfig | null;
  proposal_defaults: ProposalDefaults;
}

// Возвращает текущего залогиненного дизайнера, создавая строку при первом входе
// (magic-link создаёт auth.users, но не public.designers).
export async function getOrCreateDesigner(): Promise<DesignerRow | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: existing } = await supabase
    .from("designers")
    .select("id, name, studio_name, pricing, proposal_defaults")
    .eq("id", user.id)
    .maybeSingle();

  if (existing) return existing as DesignerRow;

  const seed = {
    id: user.id,
    name: "",
    studio_name: "",
    pricing: null,
    proposal_defaults: { exclusions: [], revision_limit: 2, stage_completion: "" },
  };
  const { data: created } = await supabase
    .from("designers")
    .insert(seed)
    .select("id, name, studio_name, pricing, proposal_defaults")
    .single();

  return (created as DesignerRow) ?? (seed as DesignerRow);
}
