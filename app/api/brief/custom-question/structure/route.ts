import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  buildCustomQuestionPrompt,
  customBriefQuestionSchema,
  fallbackQuestionFromPhrase,
  llmStructuredQuestionSchema,
  sanitizeDesignerPrompt,
} from "@/lib/brief/custom-questions";
import { completeJSON } from "@/lib/llm/provider";
import { getStudio } from "@/lib/studio";

export const dynamic = "force-dynamic";

const Body = z.object({
  phrase: z.string().trim().min(5).max(500),
});

export async function POST(request: Request) {
  const studio = await getStudio();
  if (!studio) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!(await checkRateLimit("custom_question_structure", clientIp(request), 30, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const phrase = sanitizeDesignerPrompt(parsed.data.phrase);
  const prompt = buildCustomQuestionPrompt(phrase);
  const result = await completeJSON(prompt, llmStructuredQuestionSchema);

  if (result.ok) {
    const normalized = customBriefQuestionSchema.safeParse({
      ...result.data,
      source: "llm",
      original_prompt: phrase,
    });
    if (normalized.success) {
      return NextResponse.json({ ok: true, llmOk: true, repaired: result.repaired, question: normalized.data });
    }
  }

  return NextResponse.json({
    ok: true,
    llmOk: false,
    error: result.ok ? "invalid_structured_question" : result.error,
    question: fallbackQuestionFromPhrase(phrase, "voice"),
  });
}
