import { NextResponse } from "next/server";
import { createScopedServiceClient } from "@/lib/supabase/token-scoped";
import { getProjectByIntakeToken } from "@/lib/intake";

export const dynamic = "force-dynamic";

// Клиент начал бриф → событие brief_started, статус brief_in_progress.
export async function POST(request: Request) {
  const { token } = (await request.json().catch(() => ({}))) as { token?: string };
  const project = await getProjectByIntakeToken(token ?? "");
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const admin = createScopedServiceClient("intake-start");

  try {

    // событие brief_started — только один раз
    if (project.status === "created") {
      const update = await admin.from("projects").update({ status: "brief_in_progress" }).eq("id", project.id);
      if (update.error) throw new Error("update_failed");
      const started = await admin.from("events").insert({
        designer_id: project.designer_id,
        project_id: project.id,
        type: "brief_started",
      });
      if (started.error) throw new Error("event_failed");
    }

    return NextResponse.json({ ok: true });
  } catch {
    try {
      await admin.from("events").insert({
        designer_id: project.designer_id, project_id: project.id, type: "intake_start_failed",
      });
    } catch { /* Telemetry must not mask the operation failure. */ }
    return NextResponse.json({ error: "intake_start_failed" }, { status: 500 });
  }
}
