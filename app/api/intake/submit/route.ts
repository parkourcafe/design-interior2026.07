import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProjectByIntakeToken } from "@/lib/intake";
import { runRiskPipeline } from "@/lib/brief/pipeline";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import type { AnswersMap } from "@/lib/types";
import {
  declaredInitialBriefRequestTooLarge,
  InitialBriefRequestTooLargeError,
  parseInitialBriefInput,
  readBoundedInitialBriefBody,
} from "@/lib/platform/initial-brief-input-validation";
import {
  closeInitialBriefAiCall,
  finalizeInitialBrief,
  recordInitialBriefAiUsage,
  reserveInitialBriefAiCall,
} from "@/lib/platform/m1-workflow";
import { deriveInitialBriefRequestIdentity } from "@/lib/platform/initial-brief-request-identity";

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

  if (declaredInitialBriefRequestTooLarge(request.headers)) {
    return NextResponse.json(
      { error: "request_too_large" },
      { status: 413 },
    );
  }

  let body: ReturnType<typeof parseInitialBriefInput>;
  try {
    const rawBody = await readBoundedInitialBriefBody(request);
    if (rawBody === null) {
      return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    }
    body = parseInitialBriefInput(rawBody);
  } catch (error) {
    if (error instanceof InitialBriefRequestTooLargeError) {
      return NextResponse.json(
        { error: "request_too_large" },
        { status: 413 },
      );
    }
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const project = await getProjectByIntakeToken(body.token);
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!project.designer_id) {
    return NextResponse.json(
      { error: "intake_owner_required" },
      { status: 409 },
    );
  }

  const answers = body.answers as AnswersMap;
  const admin = createAdminClient();
  // The identity helper hashes a recursively canonical answer snapshot with
  // SHA256 so retries cannot depend on object insertion order.
  const { answerDigest, idempotencyKey } =
    deriveInitialBriefRequestIdentity(project.id, answers);

  // Reserve before any mutable intake write or provider request. The project row
  // lock inside the command makes the accepted answer snapshot the only one
  // allowed to proceed for this run.
  const reservation = await reserveInitialBriefAiCall(admin, {
    projectId: project.id,
    answerDigest: answerDigest,
    idempotencyKey: idempotencyKey,
  });
  if (
    !reservation.ok ||
    !reservation.workflowRunId ||
    !reservation.workflowStepRunId ||
    !reservation.aiCallId
  ) {
    return NextResponse.json(
      {
        error:
          reservation.error === "initial_brief_request_conflict"
            ? "initial_brief_request_conflict"
            : "workflow_reservation_failed",
      },
      {
        status:
          reservation.error === "initial_brief_request_conflict" ? 409 : 500,
      },
    );
  }
  if (reservation.replayed && reservation.resultSnapshot) {
    return NextResponse.json(reservation.resultSnapshot);
  }

  // The provider runs only after the durable reservation. Every failure closes
  // that exact reservation, and a closure failure gets its own stable response.
  let pipeline: Awaited<ReturnType<typeof runRiskPipeline>>;
  try {
    pipeline = await runRiskPipeline(answers);
  } catch {
    try {
      const providerClosure = await closeInitialBriefAiCall(admin, {
        projectId: project.id,
        workflowRunId: reservation.workflowRunId,
        workflowStepRunId: reservation.workflowStepRunId,
        aiCallId: reservation.aiCallId,
        errorCode: "provider_execution_failed",
      });
      if (!providerClosure.ok) {
        return NextResponse.json(
          { error: "workflow_terminalization_failed" },
          { status: 500 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: "workflow_terminalization_failed" },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: "brief_analysis_failed" },
      { status: 502 },
    );
  }
  const { passport, cards, llmOk, llmUsage } = pipeline;

  let usage: Awaited<ReturnType<typeof recordInitialBriefAiUsage>>;
  try {
    usage = await recordInitialBriefAiUsage(admin, {
      projectId: project.id,
      workflowRunId: reservation.workflowRunId,
      workflowStepRunId: reservation.workflowStepRunId,
      aiCallId: reservation.aiCallId,
      llmUsage,
    });
  } catch {
    try {
      const usageExceptionClosure = await closeInitialBriefAiCall(admin, {
        projectId: project.id,
        workflowRunId: reservation.workflowRunId,
        workflowStepRunId: reservation.workflowStepRunId,
        aiCallId: reservation.aiCallId,
        errorCode: "usage_persistence_failed",
      });
      if (!usageExceptionClosure.ok) {
        return NextResponse.json(
          { error: "workflow_terminalization_failed" },
          { status: 500 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: "workflow_terminalization_failed" },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: "workflow_usage_persistence_failed" },
      { status: 500 },
    );
  }
  if (!usage.ok) {
    try {
      const usageFailureClosure = await closeInitialBriefAiCall(admin, {
        projectId: project.id,
        workflowRunId: reservation.workflowRunId,
        workflowStepRunId: reservation.workflowStepRunId,
        aiCallId: reservation.aiCallId,
        errorCode: "usage_persistence_failed",
      });
      if (!usageFailureClosure.ok) {
        return NextResponse.json(
          { error: "workflow_terminalization_failed" },
          { status: 500 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: "workflow_terminalization_failed" },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: "workflow_usage_persistence_failed" },
      { status: 500 },
    );
  }

  // Legacy M1 state and governed workflow state commit in one database
  // transaction. The finalizer validates the measured call but never rewrites it.
  try {
    const finalization = await finalizeInitialBrief(admin, {
      projectId: project.id,
      workflowRunId: reservation.workflowRunId,
      workflowStepRunId: reservation.workflowStepRunId,
      aiCallId: reservation.aiCallId,
      answerDigest,
      answers,
      passport,
      riskCards: cards,
    });
    if (!finalization.ok) {
      try {
        const finalizationFailureClosure = await closeInitialBriefAiCall(admin, {
          projectId: project.id,
          workflowRunId: reservation.workflowRunId,
          workflowStepRunId: reservation.workflowStepRunId,
          aiCallId: reservation.aiCallId,
          errorCode: "workflow_finalization_failed",
        });
        if (!finalizationFailureClosure.ok) {
          return NextResponse.json(
            { error: "workflow_terminalization_failed" },
            { status: 500 },
          );
        }
      } catch {
        return NextResponse.json(
          { error: "workflow_terminalization_failed" },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: "workflow_persistence_failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      llmOk,
      workflowRunId: finalization.workflowRunId,
    });
  } catch {
    try {
      const finalizationExceptionClosure = await closeInitialBriefAiCall(admin, {
        projectId: project.id,
        workflowRunId: reservation.workflowRunId,
        workflowStepRunId: reservation.workflowStepRunId,
        aiCallId: reservation.aiCallId,
        errorCode: "workflow_finalization_failed",
      });
      if (!finalizationExceptionClosure.ok) {
        return NextResponse.json(
          { error: "workflow_terminalization_failed" },
          { status: 500 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: "workflow_terminalization_failed" },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: "workflow_persistence_failed" },
      { status: 500 },
    );
  }
}
