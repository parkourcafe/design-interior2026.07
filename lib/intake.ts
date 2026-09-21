import type { DataCellId } from "@/lib/market/contract";
import { createRegionalPublicTokenClient } from "@/lib/supabase/regional-admin";
import { normalizeCustomQuestions, type CustomBriefQuestion } from "@/lib/brief/custom-questions";

export interface IntakeProject {
  id: string;
  designer_id: string | null; // null → клиентский бриф без дизайнера
  client_name: string;
  status: string;
  custom_questions: CustomBriefQuestion[]; // свои вопросы дизайнера
  cellCode: DataCellId;
}

const opaqueToken = /^[A-Za-z0-9_-]{20,}$/;

/** Cell prefix is routing metadata, never customer data. Old links default RU. */
export function parseIntakeLinkToken(value: string): { cellCode: DataCellId; token: string } | null {
  const matched = /^(?:(ru|us)\.)?([A-Za-z0-9_-]+)$/.exec(value);
  const opaque = matched?.[2];
  if (!matched || !opaque || !opaqueToken.test(opaque)) return null;
  return { cellCode: (matched[1] ?? "ru") as DataCellId, token: opaque };
}

export function formatIntakeLinkToken(cellCode: DataCellId, token: string): string {
  if (!opaqueToken.test(token)) throw new Error("invalid_intake_token");
  return `${cellCode}.${token}`;
}

// Сверка intake-токена на сервере (service role). anon-ключ доступа не даёт —
// публичный доступ авторизуется ТОЛЬКО этим токеном.
export async function getProjectByIntakeToken(token: string): Promise<IntakeProject | null> {
  const routed = parseIntakeLinkToken(token);
  if (!routed) return null;
  const admin = createRegionalPublicTokenClient(routed.cellCode, "public-intake-read");
  // B4 (Фаза 2): токен с истёкшим сроком неотличим от несуществующего —
  // наружу не утекает даже факт его бывшего существования.
  const { data } = await admin
    .from("projects")
    .select("id, designer_id, client_name, status, custom_questions, intake_expires_at")
    .eq("intake_token", routed.token)
    .or("intake_expires_at.is.null,intake_expires_at.gt.now()")
    .maybeSingle();
  if (!data) return null;
  return {
    ...(data as Omit<IntakeProject, "cellCode">),
    custom_questions: normalizeCustomQuestions((data as { custom_questions?: unknown }).custom_questions),
    cellCode: routed.cellCode,
  };
}
