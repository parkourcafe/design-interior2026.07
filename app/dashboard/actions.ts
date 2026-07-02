"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { makeToken } from "@/lib/tokens";

export interface CreateProjectResult {
  ok: boolean;
  projectId?: string;
  error?: string;
}

// Создать проект → сгенерировать intake-токен → событие intake_link_created.
export async function createProject(clientName: string): Promise<CreateProjectResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const intakeToken = makeToken();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      designer_id: user.id,
      client_name: clientName.trim() || "Без имени",
      status: "created",
      intake_token: intakeToken,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "insert_failed" };

  await supabase.from("events").insert({
    designer_id: user.id,
    project_id: data.id,
    type: "intake_link_created",
  });

  revalidatePath("/dashboard");
  return { ok: true, projectId: data.id };
}
