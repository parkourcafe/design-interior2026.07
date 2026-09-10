import { createScopedServiceClient } from "@/lib/supabase/token-scoped";
import { normalizeCustomQuestions, type CustomBriefQuestion } from "@/lib/brief/custom-questions";

export interface IntakeProject {
  id: string;
  designer_id: string | null; // null → клиентский бриф без дизайнера
  client_name: string;
  status: string;
  custom_questions: CustomBriefQuestion[]; // свои вопросы дизайнера
}

// Сверка intake-токена на сервере (service role). anon-ключ доступа не даёт —
// публичный доступ авторизуется ТОЛЬКО этим токеном.
export async function getProjectByIntakeToken(token: string): Promise<IntakeProject | null> {
  if (!token) return null;
  const admin = createScopedServiceClient("public-intake-read");
  // B4 (Фаза 2): токен с истёкшим сроком неотличим от несуществующего —
  // наружу не утекает даже факт его бывшего существования.
  const { data } = await admin
    .from("projects")
    .select("id, designer_id, client_name, status, custom_questions, intake_expires_at")
    .eq("intake_token", token)
    .or("intake_expires_at.is.null,intake_expires_at.gt.now()")
    .maybeSingle();
  if (!data) return null;
  return {
    ...(data as IntakeProject),
    custom_questions: normalizeCustomQuestions((data as { custom_questions?: unknown }).custom_questions),
  };
}
