import { enforceIntakeConsent, intakeTokenMatches } from "@/lib/legal/intake-consent";
import { NextResponse } from "next/server";
import { createScopedServiceClient } from "@/lib/supabase/token-scoped";
import { getProjectByIntakeToken } from "@/lib/intake";

export const dynamic = "force-dynamic";

// Клиент начал бриф → событие brief_started, статус brief_in_progress.
export async function POST(request: Request) {
  const denied = await enforceIntakeConsent(request);
  if (denied) return denied;
  const { token } = (await request.json().catch(() => ({}))) as { token?: string };
  if (!intakeTokenMatches(request, token)) return NextResponse.json({ error: "invalid_scope" }, { status: 403 });
  const project = await getProjectByIntakeToken(token ?? "");
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const admin = createScopedServiceClient("intake-start");

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
