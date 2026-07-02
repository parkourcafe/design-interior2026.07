import { createAdminClient } from "@/lib/supabase/admin";

export interface IntakeProject {
  id: string;
  designer_id: string;
  client_name: string;
  status: string;
}

// Сверка intake-токена на сервере (service role). anon-ключ доступа не даёт —
// публичный доступ авторизуется ТОЛЬКО этим токеном.
export async function getProjectByIntakeToken(token: string): Promise<IntakeProject | null> {
  if (!token) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("projects")
    .select("id, designer_id, client_name, status")
    .eq("intake_token", token)
    .maybeSingle();
  return (data as IntakeProject) ?? null;
}
