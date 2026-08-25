"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { makeToken } from "@/lib/tokens";

// B4 (Фаза 2): управление сроком жизни токена брифа. Истечение проверяет
// сервер при каждом открытии брифа (lib/intake.ts); здесь — отзыв и продление.

async function requireOwnedProject(projectId: string) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return { supabase, error: "unauthenticated" as const };
  const { data: project } = await supabase
    .from("projects")
    .select("id, designer_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { supabase, error: "not_found" as const };
  if (project.designer_id !== user.id) {
    return { supabase, error: "forbidden" as const };
  }
  return { supabase, project, error: null };
}

export async function revokeIntakeLink(
  projectId: string,
): Promise<{ ok: boolean }> {
  const { supabase, error } = await requireOwnedProject(projectId);
  if (error) return { ok: false };
  // Отзыв = срок в прошлом: ссылка умирает, история брифа остаётся.
  const { error: updateError } = await supabase
    .from("projects")
    .update({ intake_expires_at: new Date(0).toISOString() })
    .eq("id", projectId);
  if (!updateError) revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: !updateError };
}

export async function extendIntakeLink(
  projectId: string,
  days = 30,
): Promise<{ ok: boolean }> {
  const { supabase, error } = await requireOwnedProject(projectId);
  if (error) return { ok: false };
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const { error: updateError } = await supabase
    .from("projects")
    .update({ intake_expires_at: expires.toISOString() })
    .eq("id", projectId);
  if (!updateError) revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: !updateError };
}

export async function regenerateIntakeToken(
  projectId: string,
): Promise<{ ok: boolean }> {
  const { supabase, error } = await requireOwnedProject(projectId);
  if (error) return { ok: false };
  // Новый токен + срок: старая ссылка умирает навсегда (токен не восстанавливить).
  const { error: updateError } = await supabase
    .from("projects")
    .update({
      intake_token: makeToken(),
      intake_expires_at: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    })
    .eq("id", projectId);
  if (!updateError) revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: !updateError };
}
