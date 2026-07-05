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
  email: string; // запасной идентификатор, если имя/студия не заполнены
  profile: DesignerProfile;
}

// Профиль заполнен достаточно, чтобы отправлять бриф клиенту: есть имя/студия
// И телефон И email (соцсети — по желанию). Клиент должен видеть, от кого бриф.
export function isProfileComplete(d: {
  name?: string;
  studio_name?: string;
  profile?: DesignerProfile;
}): boolean {
  const hasName = Boolean((d.name ?? "").trim() || (d.studio_name ?? "").trim());
  const p = d.profile ?? {};
  const hasPhone = Boolean((p.phone ?? "").trim());
  const hasEmail = Boolean((p.email ?? "").trim());
  return hasName && hasPhone && hasEmail;
}

// Публичные данные дизайнера для показа клиенту на брифе (service role, без сессии).
// email берём из auth.users как запасной идентификатор — чтобы клиент ВСЕГДА
// знал, от кого пришёл бриф, даже если дизайнер не заполнил имя/студию.
export async function getDesignerPublic(designerId: string): Promise<DesignerPublic | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("designers")
    .select("name, studio_name, profile")
    .eq("id", designerId)
    .maybeSingle();
  if (!data) return null;

  let email = "";
  const { data: userRes } = await admin.auth.admin.getUserById(designerId);
  email = userRes?.user?.email ?? "";

  return {
    name: (data as { name?: string }).name ?? "",
    studio_name: (data as { studio_name?: string }).studio_name ?? "",
    email,
    profile: ((data as { profile?: DesignerProfile }).profile ?? {}) as DesignerProfile,
  };
}
