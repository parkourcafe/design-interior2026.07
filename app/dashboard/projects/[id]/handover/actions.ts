"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStudio } from "@/lib/studio";
import type { Passport, ProposalSection } from "@/lib/types";
import {
  contractorPassport,
  isFileDecision,
  normalizeContractorSections,
  type DraftFile,
  type FileDecision,
} from "@/lib/project-room/handover";
import { findSensitive } from "@/lib/project-room/sensitive";
import { loadHandoverState } from "@/lib/project-room/handover-state";
import {
  applyCorrection,
  isCorrectionField,
  parseCorrectionValue,
  readCorrectionField,
} from "@/lib/project-room/passport-correction";

const MAX_SECTIONS = 30;
const MAX_BODY = 20_000;

function revalidate(projectId: string) {
  revalidatePath(`/dashboard/projects/${projectId}/handover`);
  revalidatePath(`/dashboard/projects/${projectId}/proposal`);
}

export interface SaveHandoverInput {
  readonly sections: readonly ProposalSection[];
  readonly acknowledged: readonly string[];
  readonly decisions: readonly { readonly source_path: string; readonly decision: FileDecision; readonly reviewed: boolean }[];
}

/**
 * Сохранить текст для исполнителя, отметки «оставить» и решения по файлам.
 * Любая правка после сверки сбрасывает подтверждение (это делает база).
 */
export async function saveHandoverDraft(projectId: string, input: SaveHandoverInput): Promise<{ ok: boolean; reason?: string }> {
  const supabase = await createClient();
  const studio = await getStudio();
  if (!studio) return { ok: false, reason: "unauthorized" };
  const loaded = await loadHandoverState(supabase, projectId);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  const { state } = loaded;
  if (state.kit) return { ok: false, reason: "kit_exists" };

  if (!Array.isArray(input.sections) || input.sections.length > MAX_SECTIONS) return { ok: false, reason: "bad_request" };
  const known = new Map(state.draft.contractor_sections.map((s) => [s.id, s.title]));
  const sections = normalizeContractorSections(input.sections.filter((s) =>
    s && typeof s.id === "string" && known.has(s.id) && typeof s.body === "string" && s.body.length <= MAX_BODY,
  ).map((s) => ({ id: s.id, title: known.get(s.id) ?? s.title, body: s.body })));

  const decisions = new Map<string, { decision: FileDecision; reviewed: boolean }>();
  for (const d of Array.isArray(input.decisions) ? input.decisions : []) {
    if (d && typeof d.source_path === "string" && isFileDecision(d.decision)) {
      decisions.set(d.source_path, { decision: d.decision, reviewed: d.reviewed === true });
    }
  }
  const files: DraftFile[] = state.files.map((file) => {
    const next = decisions.get(file.source_path);
    if (!next) return file;
    // «Безопасная копия» — только если копия уже загружена.
    const decision: FileDecision = next.decision === "safe_copy" && !file.safe_copy ? file.decision : next.decision;
    const included = decision === "original" || decision === "safe_copy";
    return { ...file, decision, reviewed: included && next.reviewed };
  });

  const currentIds = new Set(findSensitive(sections, state.summary).map((f) => f.id));
  const acknowledged = Array.from(new Set((Array.isArray(input.acknowledged) ? input.acknowledged : [])
    .filter((id): id is string => typeof id === "string" && currentIds.has(id))));

  const { error } = await supabase.from("project_handover_drafts")
    .update({ contractor_sections: sections, files, acknowledged })
    .eq("id", state.draft.id);
  if (error) return { ok: false, reason: "save_failed" };
  revalidate(projectId);
  return { ok: true };
}

/** Правка поля паспорта: новая ревизия паспорта (триггер) и запись в журнале правок. */
export async function correctPassportField(projectId: string, field: string, raw: unknown): Promise<{ ok: boolean; reason?: string }> {
  const supabase = await createClient();
  const studio = await getStudio();
  if (!studio) return { ok: false, reason: "unauthorized" };
  if (!isCorrectionField(field)) return { ok: false, reason: "bad_field" };
  const value = parseCorrectionValue(field, raw);
  if (value === null) return { ok: false, reason: "bad_value" };

  const { data: project } = await supabase.from("projects").select("passport").eq("id", projectId).maybeSingle();
  const passport = (project as { passport: Passport | null } | null)?.passport;
  if (!passport) return { ok: false, reason: "not_found" };
  const before = readCorrectionField(passport, field);
  if (before === value) return { ok: true };

  const { error } = await supabase.from("projects").update({ passport: applyCorrection(passport, field, value) }).eq("id", projectId);
  if (error) return { ok: false, reason: "save_failed" };
  await supabase.from("project_passport_corrections").insert({
    project_id: projectId,
    field,
    before_value: before === undefined ? null : before,
    after_value: value,
    corrected_by: studio.userId,
  });
  await supabase.from("events").insert({ designer_id: studio.studioId, project_id: projectId, type: "passport_corrected" });
  revalidate(projectId);
  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: true };
}

/**
 * Подтвердить сверку: ровно текущий текст, решения по файлам, отметки и паспорт.
 * Сервер заново считает подсветки и блокеры — подтвердить с ними нельзя.
 */
export async function confirmHandover(projectId: string): Promise<{ ok: boolean; reason?: string }> {
  const supabase = await createClient();
  const studio = await getStudio();
  if (!studio) return { ok: false, reason: "unauthorized" };
  const loaded = await loadHandoverState(supabase, projectId);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  const { state } = loaded;
  if (state.kit) return { ok: false, reason: "kit_exists" };
  if (state.blockers.length > 0) return { ok: false, reason: "blocked" };

  const { error } = await supabase.from("project_handover_drafts").update({
    files: state.files,
    confirmed_at: new Date().toISOString(),
    confirmed_by: studio.userId,
    confirmed_sections: state.draft.contractor_sections,
    confirmed_files: state.files,
    confirmed_acknowledged: state.draft.acknowledged,
    confirmed_passport: state.passport,
    confirmed_passport_summary: contractorPassport(state.passport),
  }).eq("id", state.draft.id);
  if (error) return { ok: false, reason: "confirm_failed" };
  await supabase.from("events").insert({ designer_id: studio.studioId, project_id: projectId, type: "handover_reconciled" });
  revalidate(projectId);
  return { ok: true };
}
