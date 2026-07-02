import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProjectByIntakeToken } from "@/lib/intake";

export const dynamic = "force-dynamic";

// Клиент начал бриф → событие brief_started, статус brief_in_progress.
export async function POST(request: Request) {
  const { token } = (await request.json().catch(() => ({}))) as { token?: string };
  const project = await getProjectByIntakeToken(token ?? "");
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const admin = createAdminClient();

  // событие brief_started — только один раз
  if (project.status === "created") {
    await admin.from("projects").update({ status: "brief_in_progress" }).eq("id", project.id);
    await admin.from("events").insert({
      designer_id: project.designer_id,
      project_id: project.id,
      type: "brief_started",
    });
  }

  return NextResponse.json({ ok: true });
}
