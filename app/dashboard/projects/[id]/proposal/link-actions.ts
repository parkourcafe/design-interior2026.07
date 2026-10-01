"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLatestProposal } from "@/lib/proposal/latest";
import { extendedPublicLinkExpiry } from "@/lib/proposal/public-link";

// Срок клиентской ссылки на КП (20260928156000): продлить на 90 дней от
// сегодня или отозвать. Запись — от имени дизайнера под RLS; база сама не
// даёт убрать срок или поставить его дальше 90 дней.
async function setLinkExpiry(projectId: string, expiresAt: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const latest = await getLatestProposal(supabase, projectId);
  if (!latest || (latest.status !== "sent" && latest.status !== "accepted")) return { ok: false };
  const { data, error } = await supabase
    .from("proposals")
    .update({ public_expires_at: expiresAt })
    .eq("id", latest.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false };
  revalidatePath(`/dashboard/projects/${projectId}/proposal`);
  return { ok: true };
}

export async function extendProposalLink(projectId: string): Promise<{ ok: boolean }> {
  return setLinkExpiry(projectId, extendedPublicLinkExpiry());
}

export async function revokeProposalLink(projectId: string): Promise<{ ok: boolean }> {
  return setLinkExpiry(projectId, new Date().toISOString());
}
