import { NextResponse } from "next/server";
import { createRegionalPublicTokenClient } from "@/lib/supabase/regional-admin";
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
  const admin = createRegionalPublicTokenClient(project.cellCode, "intake-submit");

  try {

    // 1. Сохранить сырые ответы (upsert по project_id + question_id).
    const answerRows = Object.entries(answers).map(([question_id, value]) => ({
      project_id: project.id,
      question_id,
      value,
    }));
    if (answerRows.length > 0) {
      const saved = await admin.from("answers").upsert(answerRows, { onConflict: "project_id,question_id" });
      if (saved.error) throw new Error("answers_failed");
    }

    // 2. Полный проход: паспорт + карточки (деградация внутри пайплайна).
    const { passport, cards, llmOk } = await runRiskPipeline(answers);

    // 3. Записать паспорт. Имя клиента — из контакта (чтобы дизайнер понимал,
    // чья это заявка среди множества).
    const update: Record<string, unknown> = {
      passport,
      passport_revision_llm_ok: llmOk,
      status: "brief_completed",
    };
    const contactName = passport.contact?.name?.trim();
    if (contactName) update.client_name = contactName;
    const savedProject = await admin.from("projects").update(update).eq("id", project.id);
    if (savedProject.error) throw new Error("passport_failed");

    // B1 (Фаза 2): миграция 20260829074543 создаёт неизменяемую ревизию
    // атомарно тем же UPDATE. Маршрут не получает прямого доступа к закрытому
    // реестру и не вычисляет revision_no вне транзакции.

    // 4. Пересобрать карточки: удалить прежние, вставить новые как 'proposed'.
    const removed = await admin.from("risk_cards").delete().eq("project_id", project.id);
    if (removed.error) throw new Error("risks_failed");
    if (cards.length > 0) {
      const savedCards = await admin.from("risk_cards").insert(
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
      if (savedCards.error) throw new Error("risks_failed");
    }

    // 5. Событие brief_completed.
    const completed = await admin.from("events").insert({
      designer_id: project.designer_id,
      project_id: project.id,
      type: "brief_completed",
    });
    if (completed.error) throw new Error("event_failed");
    if (!llmOk) {
      try {
        await admin.from("events").insert({ designer_id: project.designer_id, project_id: project.id, type: "intake_ai_fallback" });
      } catch { /* Successful rule fallback must remain usable. */ }
    }

    return NextResponse.json({ ok: true, llmOk });
  } catch {
    try {
      await admin.from("events").insert({
        designer_id: project.designer_id, project_id: project.id, type: "intake_submit_failed",
      });
    } catch { /* Telemetry must not mask the operation failure. */ }
    return NextResponse.json({ error: "intake_submit_failed" }, { status: 500 });
  }
}
