import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { derivePlanAssistedDraft, planAssistContextSchema } from "@/lib/brief/plan-assist";
import { createClient } from "@/lib/supabase/server";
import { getStudio } from "@/lib/studio";

export const dynamic = "force-dynamic";

const Body = planAssistContextSchema
  .extend({
    projectId: z.string().uuid(),
  })
  .strict();

export async function POST(request: Request) {
  const studio = await getStudio();
  if (!studio) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!(await checkRateLimit("custom_question_plan_assist", clientIp(request), 30, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", parsed.data.projectId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const draft = derivePlanAssistedDraft({
    project_type: parsed.data.project_type,
    description: parsed.data.description,
    area_m2: parsed.data.area_m2,
    location: parsed.data.location,
    plan_notes: parsed.data.plan_notes,
    plan_files: parsed.data.plan_files,
  });

  const { error: saveError } = await supabase.from("answers").upsert(
    {
      project_id: parsed.data.projectId,
      question_id: "designer_plan_assist",
      value: draft,
    },
    { onConflict: "project_id,question_id" },
  );
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });

  return NextResponse.json({ ok: true, draft });
}
