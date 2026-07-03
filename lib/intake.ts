import { createAdminClient } from "@/lib/supabase/admin";

export interface IntakeProject {
  id: string;
  designer_id: string | null; // null → клиентский бриф без дизайнера
  client_name: string;
  status: string;
  custom_questions: string[]; // свои вопросы дизайнера
}

// Сверка intake-токена на сервере (service role). anon-ключ доступа не даёт —
// публичный доступ авторизуется ТОЛЬКО этим токеном.
export async function getProjectByIntakeToken(token: string): Promise<IntakeProject | null> {
  if (!token) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("projects")
    .select("id, designer_id, client_name, status, custom_questions")
    .eq("intake_token", token)
    .maybeSingle();
  if (!data) return null;
  return {
    ...(data as IntakeProject),
    custom_questions: Array.isArray((data as { custom_questions?: unknown }).custom_questions)
      ? ((data as { custom_questions: unknown[] }).custom_questions.filter(
          (q): q is string => typeof q === "string",
        ) as string[])
      : [],
  };
}
