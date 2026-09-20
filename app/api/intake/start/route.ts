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

    // Reconcile a prior partial attempt: a status update may have committed
    // before its event. Retrying brief_in_progress must repair the missing
    // event instead of silently returning success forever.
    if (project.status === "created" || project.status === "brief_in_progress") {
      if (project.status === "created") {
      const update = await admin.from("projects").update({ status: "brief_in_progress" }).eq("id", project.id);
      if (update.error) throw new Error("update_failed");
      }
      const { data: existing, error: existingError } = await admin.from("events")
        .select("id").eq("project_id", project.id).eq("type", "brief_started").limit(1);
      if (existingError) throw new Error("event_read_failed");
      if (!existing?.length) {
        const started = await admin.from("events").insert({
          designer_id: project.designer_id,
          project_id: project.id,
          type: "brief_started",
        });
        if (started.error) throw new Error("event_failed");
      }
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
