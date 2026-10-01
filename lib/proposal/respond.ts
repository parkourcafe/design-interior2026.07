// Ответ клиента на публичное КП. С 20261001100000 ответ привязан к версии КП
// (proposal_responses); события events пишутся для метрик и для проектов,
// ответивших до миграции.
// Общие константы и чтение для API-роута, публичной страницы и кабинета дизайнера.

import type { SupabaseClient } from "@supabase/supabase-js";

export type ResponseAction = "accept" | "discuss" | "changes";

export const ACTION_EVENT: Record<ResponseAction, string> = {
  accept: "proposal_accepted",
  discuss: "proposal_discussion_requested",
  changes: "proposal_changes_requested",
};

export const RESPONSE_TYPES = Object.values(ACTION_EVENT);

export const RESPONSE_COMMENT_MAX = 2000;

export function isResponseAction(value: unknown): value is ResponseAction {
  return value === "accept" || value === "discuss" || value === "changes";
}

/** Замечание клиента: только к «обсудить» и «правки», обрезано, не длиннее лимита. */
export function normalizeResponseComment(action: ResponseAction, raw: unknown): string | null | "too_long" {
  if (action === "accept" || typeof raw !== "string") return null;
  const comment = raw.trim();
  if (!comment) return null;
  return comment.length > RESPONSE_COMMENT_MAX ? "too_long" : comment;
}

export interface IssuedProposalRef {
  readonly id: string;
  readonly project_id: string;
  readonly version: number;
  readonly sent_at?: string | null;
}

export interface ProposalResponseState {
  /** Тип события ответа (proposal_accepted …) или null, если ответа нет. */
  readonly eventType: string | null;
  readonly comment: string | null;
}

const NO_RESPONSE: ProposalResponseState = { eventType: null, comment: null };

/**
 * Ответ клиента на конкретную версию КП.
 *
 * Проекты, ответившие до миграции, не имеют строк proposal_responses: для них
 * действует прежнее правило — первое событие ответа проекта, но только если оно
 * записано после отправки этой версии (новая версия, выпущенная после ответа на
 * старую, этим событием не закрывается).
 */
export async function readProposalResponse(
  client: SupabaseClient,
  proposal: IssuedProposalRef,
): Promise<ProposalResponseState> {
  const { data: rows, error } = await client
    .from("proposal_responses")
    .select("proposal_id, action, comment")
    .eq("project_id", proposal.project_id)
    .limit(100);
  if (error) throw new Error("response_read_failed");
  const responses = (Array.isArray(rows) ? rows : []) as Array<{ proposal_id: string; action: string; comment: string | null }>;
  const own = responses.find((row) => row.proposal_id === proposal.id);
  if (own && isResponseAction(own.action)) {
    return { eventType: ACTION_EVENT[own.action], comment: own.comment ?? null };
  }
  if (responses.length > 0) return NO_RESPONSE;

  const { data: legacy, error: legacyError } = await client
    .from("events")
    .select("type, created_at")
    .eq("project_id", proposal.project_id)
    .in("type", RESPONSE_TYPES)
    .order("created_at", { ascending: true })
    .limit(1);
  if (legacyError) throw new Error("response_read_failed");
  const first = (Array.isArray(legacy) ? legacy : [])[0] as { type: string; created_at?: string | null } | undefined;
  if (!first) return NO_RESPONSE;
  if (proposal.sent_at && first.created_at && Date.parse(first.created_at) < Date.parse(proposal.sent_at)) {
    return NO_RESPONSE;
  }
  return { eventType: first.type, comment: null };
}

/** Есть ли у проекта более новая выданная клиенту версия КП. */
export async function hasNewerIssuedVersion(
  client: SupabaseClient,
  proposal: IssuedProposalRef,
): Promise<boolean> {
  const { data, error } = await client
    .from("proposals")
    .select("id, version, status")
    .eq("project_id", proposal.project_id)
    .in("status", ["sent", "accepted"]);
  if (error) throw new Error("proposal_read_failed");
  const rows = Array.isArray(data) ? data as Array<{ version: number }> : [];
  return rows.some((row) => row.version > proposal.version);
}
