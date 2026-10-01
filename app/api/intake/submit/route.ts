import { NextResponse } from "next/server";
import { createRegionalPublicTokenClient } from "@/lib/supabase/regional-admin";
import { getProjectByIntakeToken } from "@/lib/intake";
import { INTAKE_OPEN_STATUSES, isIntakeOpen } from "@/lib/intake-status";
import { runRiskPipeline } from "@/lib/brief/pipeline";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { MAX_SUBMIT_BODY_BYTES, validateSubmittedAnswers } from "@/lib/brief/answer-schema";
import {
  INTAKE_CONSENT_VERSION,
  consentOperatorLabel,
  consentStudioLabel,
  consentTextSha256,
  intakeConsentText,
} from "@/lib/legal/consent";
import { getDesignerPublic } from "@/lib/designer";
import type { RiskCard } from "@/lib/types";

export const dynamic = "force-dynamic";
// Запас на анализ рисков: AI ограничен таймаутом (lib/llm), после него —
// карточки по правилам. Функция не должна обрываться платформой раньше.
export const maxDuration = 60;

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

  // Размер тела — до разбора: бриф из мастера занимает единицы килобайт.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_SUBMIT_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const text = await request.text().catch(() => "");
  if (Buffer.byteLength(text, "utf8") > MAX_SUBMIT_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  let body: { token?: unknown; answers?: unknown };
  try {
    body = JSON.parse(text) as { token?: unknown; answers?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const project = await getProjectByIntakeToken(typeof body.token === "string" ? body.token : "");
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // DEC-044 (a): студия закрывает аккаунт — бриф только для чтения. Отказ до
  // любой записи (в том числе до загрузки файла в хранилище).
  if (project.archived) return NextResponse.json({ error: "brief_closed" }, { status: 409 });
  // Повторная отправка после завершения брифа запрещена: иначе она откатывает
  // статус проекта и затирает принятые дизайнером карточки рисков.
  if (!isIntakeOpen(project.status)) {
    return NextResponse.json({ error: "already_submitted" }, { status: 409 });
  }

  // Только ответы, которые умеет записать мастер брифа (lib/brief/answer-schema.ts).
  const validated = validateSubmittedAnswers(body.answers ?? {}, project.custom_questions);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error, field: validated.field }, { status: 400 });
  }
  // Согласие на обработку ПДн проверяет сервер, а не только браузер.
  if (!validated.consent) {
    return NextResponse.json({ error: "consent_required" }, { status: 422 });
  }
  const answers = validated.answers;
  const admin = createRegionalPublicTokenClient(project.cellCode, "intake-submit");

  try {
    // 0. Зафиксировать согласие: время ставит база; текст (со студией и
    // сервисом) сервер собирает сам, тем же кодом, что и для страницы брифа, и
    // пишет вместе с хешем и версией. Без записи согласия ответы не сохраняются.
    const designer = project.designer_id ? await getDesignerPublic(project.designer_id) : null;
    // Не записывать согласие с неверной стороной: проект студии без профиля.
    if (project.designer_id && !designer) throw new Error("consent_failed");
    const consentText = intakeConsentText(consentStudioLabel(designer), consentOperatorLabel());
    const consent = await admin.from("intake_consent_records").insert({
      project_id: project.id,
      consent_version: INTAKE_CONSENT_VERSION,
      consent_text_sha256: consentTextSha256(consentText),
      consent_text: consentText,
      source: project.designer_id ? "designer_intake" : "self_serve_intake",
    });
    if (consent.error) throw new Error("consent_failed");


    // 1. Сохранить сырые ответы (upsert по project_id + question_id) — до
    // перехода статуса: если что-то упадёт позже, ответы не потеряются и
    // «Пересобрать карточки» не построит паспорт из пустоты. Завершённый бриф
    // сюда не доходит (проверка статуса выше); остаётся лишь окно двух
    // одновременных отправок, которое закрывает условный переход ниже.
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

    // 3. Записать паспорт и статус (условно). Имя клиента — из контакта
    // (чтобы дизайнер понимал, чья это заявка среди множества).
    const update: Record<string, unknown> = {
      passport,
      passport_revision_llm_ok: llmOk,
      status: "brief_completed",
    };
    const contactName = passport.contact?.name?.trim();
    if (contactName) update.client_name = contactName;
    // Условный переход закрывает гонку двух параллельных отправок: только
    // одна из них застанет открытый статус и дойдёт до пересборки карточек.
    const savedProject = await admin.from("projects").update(update)
      .eq("id", project.id)
      .in("status", [...INTAKE_OPEN_STATUSES])
      .select("id")
      .maybeSingle();
    if (savedProject.error) throw new Error("passport_failed");
    if (!savedProject.data) {
      return NextResponse.json({ error: "already_submitted" }, { status: 409 });
    }

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
