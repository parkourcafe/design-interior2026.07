import type { SupabaseClient } from "@supabase/supabase-js";

// B2 (Фаза 2): версия КП — настоящий номер. Все операции дашборда работают
// с ПОСЛЕДНЕЙ версией проекта; прежние версии — неизменяемая история
// (у каждой свой public_token, принятие клиента естественно привязано
// к своей версии).

export interface ProposalRow {
  id: string;
  version: number;
  sections: unknown;
  status: string;
  public_token: string;
}

/** Последняя версия КП проекта (по номеру версии). */
export async function getLatestProposal(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProposalRow | null> {
  const { data } = await supabase
    .from("proposals")
    .select("id, version, sections, status, public_token")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ProposalRow | null) ?? null;
}

/**
 * Следующий номер версии. Уникальный индекс
 * proposals_project_version_key страхует гонку: параллельное создание
 * получит конфликт 23505, а не тихий дубль.
 */
export async function nextProposalVersion(
  supabase: SupabaseClient,
  projectId: string,
): Promise<number> {
  const { data } = await supabase
    .from("proposals")
    .select("version")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data as { version?: number } | null)?.version ?? 0) + 1;
}
