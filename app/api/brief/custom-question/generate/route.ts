import { NextResponse } from "next/server";
import { z } from "zod";
import {
  BRIEF_PACK_PROJECT_TYPES,
  briefPackContextSchema,
  briefPackPlanFileSchema,
  briefPackSchema,
  buildBriefPackPrompt,
  fallbackBriefPackFromContext,
  flattenBriefPack,
  planAssistedFactSchema,
} from "@/lib/brief/custom-questions";
import { completeJSON } from "@/lib/llm/provider";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getStudio } from "@/lib/studio";

export const dynamic = "force-dynamic";

const optionalText = (max: number) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return undefined;
      const clean = value.trim();
      return clean ? clean : undefined;
    },
    z.string().max(max).optional(),
  );

const Body = z
  .object({
    projectId: z.string().uuid().optional(),
    projectType: z.enum(BRIEF_PACK_PROJECT_TYPES).default("other"),
    description: z.string().trim().min(5).max(1000),
    areaM2: z.number().positive().max(100000).nullable().optional(),
    location: optionalText(120),
    planNotes: optionalText(1000),
    planFiles: z.array(briefPackPlanFileSchema).max(5).optional(),
    planFacts: z.array(planAssistedFactSchema).max(30).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const studio = await getStudio();
  if (!studio) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!(await checkRateLimit("custom_question_generate_pack", clientIp(request), 20, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  if (parsed.data.projectId) {
    const supabase = await createClient();
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", parsed.data.projectId)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const context = briefPackContextSchema.safeParse({
    project_type: parsed.data.projectType,
    description: parsed.data.description,
    area_m2: parsed.data.areaM2 ?? undefined,
    location: parsed.data.location,
    plan_notes: parsed.data.planNotes,
    plan_files: parsed.data.planFiles,
    plan_facts: parsed.data.planFacts,
  });
  if (!context.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const prompt = buildBriefPackPrompt(context.data);
  const result = await completeJSON(prompt, briefPackSchema);

  if (result.ok) {
    const questions = flattenBriefPack(result.data);
    if (questions.length > 0) {
      return NextResponse.json({
        ok: true,
        llmOk: true,
        repaired: result.repaired,
        questions,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    llmOk: false,
    error: result.ok ? "empty_brief_pack" : result.error,
    questions: fallbackBriefPackFromContext(context.data),
  });
}
