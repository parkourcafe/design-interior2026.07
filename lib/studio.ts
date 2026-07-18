import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDesigner, type DesignerRow } from "@/lib/designer";

const SELECT = "id, name, studio_name, pricing, proposal_defaults, profile";

export interface Studio {
  studioId: string; // designers.id владельца студии (под ним живут проекты)
  userId: string; // auth.uid() текущего пользователя
  email: string;
  role: "owner" | "member";
  designer: DesignerRow; // профиль СТУДИИ (владельца)
}

// Определяет студию текущего пользователя.
// - Владелец → своя студия (создаём строку designers при первом входе).
// - Участник → студия владельца, равный доступ (v1). Членство активируется
//   ТОЛЬКО переходом по ссылке-приглашению /join/<token> (см. app/join и
//   миграцию 0007). Здесь мы больше НЕ активируем приглашение по совпадению
//   email — иначе чужой человек, зарегистрировавший приглашённый адрес, получил
//   бы доступ к студии (email при регистрации не подтверждается).
export async function getStudio(): Promise<Studio | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const email = (user.email ?? "").toLowerCase();

  let ownerId: string | null = null;

  // Уже активный участник? (активация — только через ссылку-приглашение)
  const { data: active } = await admin
    .from("studio_members")
    .select("owner_id")
    .eq("member_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (active) ownerId = (active as { owner_id: string }).owner_id;

  // Участник: студия = владелец.
  if (ownerId) {
    const { data: designer } = await admin
      .from("designers")
      .select(SELECT)
      .eq("id", ownerId)
      .maybeSingle();
    if (!designer) return null;
    return {
      studioId: ownerId,
      userId: user.id,
      email,
      role: "member",
      designer: designer as DesignerRow,
    };
  }

  // Владелец: своя строка (создаётся при первом входе).
  const own = await getOrCreateDesigner();
  if (!own) return null;
  return { studioId: user.id, userId: user.id, email, role: "owner", designer: own };
}

export interface StudioMemberRow {
  id: string;
  email: string;
  status: "invited" | "active";
  created_at: string;
  joined_at: string | null;
  invite_token: string | null; // для копирования ссылки-приглашения (только у приглашённых)
}

// Ростер студии (для UI «Команда»). RLS отдаёт только участникам этой студии.
export async function listStudioMembers(studioId: string): Promise<StudioMemberRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("studio_members")
    .select("id, email, status, created_at, joined_at, invite_token")
    .eq("owner_id", studioId)
    .order("created_at", { ascending: true });
  return (data ?? []) as StudioMemberRow[];
}
