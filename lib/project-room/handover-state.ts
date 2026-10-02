// Состояние подготовки комплекта: принятое КП, текущий паспорт, черновик с
// решениями дизайнера, подсветки и блокеры. Читается сессией дизайнера (RLS) —
// одно и то же для страницы, подтверждения сверки и создания комплекта.

import type { createClient } from "@/lib/supabase/server";
import type { AnswersMap, Passport, ProposalSection } from "@/lib/types";
import {
  contractorPassport,
  contractorProposalSections,
  handoverBlockers,
  initialDraftFiles,
  kitFileSources,
  mergeDraftFiles,
  sameSnapshot,
  type DraftFile,
  type HandoverBlocker,
} from "@/lib/project-room/handover";
import { findSensitive, unresolvedFlags, type SensitiveFlag } from "@/lib/project-room/sensitive";

type Client = Awaited<ReturnType<typeof createClient>>;

export interface DraftRow {
  readonly id: string;
  readonly proposal_id: string;
  readonly proposal_version: number;
  readonly contractor_sections: ProposalSection[];
  readonly files: DraftFile[];
  readonly acknowledged: string[];
  readonly confirmed_at: string | null;
  readonly confirmed_sections: ProposalSection[] | null;
  readonly confirmed_files: DraftFile[] | null;
  readonly confirmed_acknowledged: string[] | null;
  readonly confirmed_passport: Passport | null;
  readonly confirmed_passport_summary: Passport | null;
}

const DRAFT_COLUMNS =
  "id, proposal_id, proposal_version, contractor_sections, files, acknowledged, confirmed_at, confirmed_sections, confirmed_files, confirmed_acknowledged, confirmed_passport, confirmed_passport_summary";

export type Reconciliation =
  | { readonly state: "none" }
  | { readonly state: "confirmed"; readonly at: string }
  // Сверка была, но паспорт изменился после неё — нужна новая.
  | { readonly state: "stale"; readonly at: string; readonly reason: "passport_changed" | "content_changed" };

export interface HandoverState {
  readonly proposal: { readonly id: string; readonly version: number; readonly sections: ProposalSection[] };
  readonly passport: Passport;
  readonly summary: Passport;
  readonly draft: DraftRow;
  /** Решения по всем текущим файлам проекта (новые — «не передавать»). */
  readonly files: DraftFile[];
  readonly flags: SensitiveFlag[];
  readonly unresolved: SensitiveFlag[];
  readonly blockers: HandoverBlocker[];
  readonly reconciliation: Reconciliation;
  readonly kit: { readonly id: string; readonly createdAt: string; readonly draftId: string | null } | null;
}

export type HandoverStateResult =
  | { readonly ok: true; readonly state: HandoverState }
  | { readonly ok: false; readonly reason: "proposal_not_accepted" | "no_passport" | "draft_failed" };

async function projectFiles(supabase: Client, projectId: string) {
  const { data: answerRows } = await supabase.from("answers").select("question_id, value")
    .eq("project_id", projectId).in("question_id", ["designer_plan_attachments", "attachments"]);
  const answers: AnswersMap = {};
  for (const row of answerRows ?? []) {
    answers[(row as { question_id: string }).question_id] = (row as { value: unknown }).value as never;
  }
  return kitFileSources(answers, projectId);
}

export async function loadHandoverState(
  supabase: Client,
  projectId: string,
  options: { readonly createDraftAs?: string } = {},
): Promise<HandoverStateResult> {
  const { data: proposalRow } = await supabase.from("proposals").select("id, version, status, sections")
    .eq("project_id", projectId).eq("status", "accepted").order("version", { ascending: false }).limit(1).maybeSingle();
  if (!proposalRow) return { ok: false, reason: "proposal_not_accepted" };
  const p = proposalRow as { id: string; version: number; sections: unknown };
  const proposal = { id: p.id, version: p.version, sections: (Array.isArray(p.sections) ? p.sections : []) as ProposalSection[] };

  const { data: project } = await supabase.from("projects").select("passport").eq("id", projectId).maybeSingle();
  const passport = (project as { passport: Passport | null } | null)?.passport;
  if (!passport) return { ok: false, reason: "no_passport" };

  const sources = await projectFiles(supabase, projectId);
  let { data: draftRow } = await supabase.from("project_handover_drafts").select(DRAFT_COLUMNS)
    .eq("project_id", projectId).maybeSingle();
  if (!draftRow && options.createDraftAs) {
    // Строка читается из ответа вставки: повторный такой же GET в одном рендере
    // Next.js отдал бы из памяти запроса — тот самый «черновика нет».
    const { data: created, error } = await supabase.from("project_handover_drafts").insert({
      project_id: projectId,
      proposal_id: proposal.id,
      proposal_version: proposal.version,
      contractor_sections: contractorProposalSections(proposal.sections),
      files: initialDraftFiles(sources),
      created_by: options.createDraftAs,
    }).select(DRAFT_COLUMNS).maybeSingle();
    draftRow = created;
    // 23505 — черновик создан в другой вкладке: читаем его другим запросом.
    if (error && (error as { code?: string }).code === "23505") {
      ({ data: draftRow } = await supabase.from("project_handover_drafts").select(DRAFT_COLUMNS)
        .eq("project_id", projectId).eq("proposal_id", proposal.id).maybeSingle());
    } else if (error) {
      return { ok: false, reason: "draft_failed" };
    }
  }
  if (!draftRow) return { ok: false, reason: "draft_failed" };
  const draft = draftRow as unknown as DraftRow;

  const summary = contractorPassport(passport);
  const files = mergeDraftFiles(draft.files, sources);
  const flags = findSensitive(draft.contractor_sections, summary);
  const unresolved = unresolvedFlags(flags, draft.acknowledged ?? []);
  const blockers = handoverBlockers({ sections: draft.contractor_sections, files, unresolvedFlagCount: unresolved.length });

  let reconciliation: Reconciliation = { state: "none" };
  if (draft.confirmed_at) {
    if (!sameSnapshot(draft.confirmed_passport, passport)) {
      reconciliation = { state: "stale", at: draft.confirmed_at, reason: "passport_changed" };
    } else if (
      !sameSnapshot(draft.confirmed_sections, draft.contractor_sections)
      || !sameSnapshot(draft.confirmed_files, draft.files)
      || !sameSnapshot(draft.confirmed_acknowledged, draft.acknowledged)
    ) {
      reconciliation = { state: "stale", at: draft.confirmed_at, reason: "content_changed" };
    } else {
      reconciliation = { state: "confirmed", at: draft.confirmed_at };
    }
  }

  const { data: room } = await supabase.from("project_rooms").select("id").eq("project_id", projectId).maybeSingle();
  const { data: kitRow } = room
    ? await supabase.from("project_handover_kits").select("id, created_at, draft_id")
      .eq("room_id", (room as { id: string }).id).maybeSingle()
    : { data: null };
  const kit = kitRow
    ? { id: (kitRow as { id: string }).id, createdAt: (kitRow as { created_at: string }).created_at, draftId: (kitRow as { draft_id: string | null }).draft_id }
    : null;

  return { ok: true, state: { proposal, passport, summary, draft, files, flags, unresolved, blockers, reconciliation, kit } };
}
