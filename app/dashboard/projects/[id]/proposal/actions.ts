"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ProposalSection } from "@/lib/types";

export async function saveProposal(
  projectId: string,
  sections: ProposalSection[],
): Promise<{ ok: boolean }> {
  const supabase = createClient();
  const { error } = await supabase
    .from("proposals")
    .update({ sections })
    .eq("project_id", projectId)
    .eq("version", 1);
  if (!error) revalidatePath(`/dashboard/projects/${projectId}/proposal`);
  return { ok: !error };
}

export async function sendProposal(projectId: string): Promise<{ ok: boolean }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { data: proposal, error } = await supabase
    .from("proposals")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("version", 1)
    .select("id")
    .maybeSingle();

  if (error || !proposal) return { ok: false };

  await supabase.from("projects").update({ status: "proposal_sent" }).eq("id", projectId);
  await supabase.from("events").insert({
    designer_id: user.id,
    project_id: projectId,
    type: "proposal_sent",
  });

  revalidatePath(`/dashboard/projects/${projectId}/proposal`);
  return { ok: true };
}
