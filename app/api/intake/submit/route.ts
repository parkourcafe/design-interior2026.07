import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProjectByIntakeToken } from "@/lib/intake";
import { runRiskPipeline } from "@/lib/brief/pipeline";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import type { AnswersMap, RiskCard } from "@/lib/types";

export const dynamic = "force-dynamic";

// Завершение брифа: сохранить answers, построить паспорт + карточки рисков
// (rules + LLM с деградацией), выставить статус brief_completed,
// событие brief_completed.
export async function POST(request: Request) {
  // Защита стоимости LLM: не более 30 завершений брифа с одного IP в час.
  if (!(await checkRateLimit("intake_submit", clientIp(request), 30, 60 * 60 * 1000))) {
    return NextResponse.json(
      { error: "Слишком много попыток. Попробуйте позже." },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    token?: string;
    answers?: AnswersMap;
  };
  const project = await getProjectByIntakeToken(body.token ?? "");
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const answers = body.answers ?? {};
  const admin = createAdminClient();

  // 1. Сохранить сырые ответы (upsert по project_id + question_id).
  const answerRows = Object.entries(answers).map(([question_id, value]) => ({
    project_id: project.id,
    question_id,
    value,
  }));
  if (answerRows.length > 0) {
    await admin.from("answers").upsert(answerRows, { onConflict: "project_id,question_id" });
  }

  // 2. Полный проход: паспорт + карточки (деградация внутри пайплайна).
  const { passport, cards, llmOk } = await runRiskPipeline(answers);

  // 3. Записать паспорт. Имя клиента — из контакта (чтобы дизайнер понимал,
  // чья это заявка среди множества).
  const update: Record<string, unknown> = { passport, status: "brief_completed" };
  const contactName = passport.contact?.name?.trim();
  if (contactName) update.client_name = contactName;
  await admin.from("projects").update(update).eq("id", project.id);

  // 4. Пересобрать карточки: удалить прежние, вставить новые как 'proposed'.
  await admin.from("risk_cards").delete().eq("project_id", project.id);
  if (cards.length > 0) {
    await admin.from("risk_cards").insert(
      cards.map((c: RiskCard) => ({
        project_id: project.id,
        risk_type: c.risk_type,
        evidence: c.evidence,
        impact: c.impact,
        confidence: c.confidence,
        designer_action: c.designer_action,
        proposal_implication: c.proposal_implication,
        status: "proposed",
        source: c.source,
      })),
    );
  }

  // 5. Событие brief_completed.
  await admin.from("events").insert({
    designer_id: project.designer_id,
    project_id: project.id,
    type: "brief_completed",
  });

  return NextResponse.json({ ok: true, llmOk });
}
