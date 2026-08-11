import { NextResponse } from "next/server";
import { z } from "zod";

import { isSameOriginMutation } from "@/lib/project-intelligence/delivery/projectceo/csrf";
import {
  createProjectCeoRequestContext,
  ProjectCeoAuthenticationError,
} from "@/lib/project-intelligence/delivery/projectceo/request-context";
import {
  isTelegramBridgeEnabled,
} from "@/lib/integration-gateway/telegram/bridge-flag";
import {
  TelegramChannelRpcError,
  TelegramInboxPort,
} from "@/lib/integration-gateway/telegram/channel-port";

export const dynamic = "force-dynamic";

/**
 * Project Inbox: посмотреть предложения из чата и решить по ним.
 *
 * Человеческий маршрут — клиент с JWT человека, порт без системных методов.
 * Решение «принять в работу» НЕ создаёт ни изменения, ни приёмки, ни решения:
 * оно отмечает карточку рассмотренной. Официальный объект человек создаёт
 * отдельной командой модуля, и порядок именно такой — сначала команда, потом
 * отметка со ссылкой, иначе ссылка указывала бы на несуществующее (A7 §1.7).
 */

const reviewSchema = z.object({
  projectId: z.string().uuid(),
  candidateId: z.string().uuid(),
  decision: z.enum(["confirm", "reject"]),
  resultingEntityKind: z.string().min(1).max(60).nullable().optional(),
  resultingEntityId: z.string().min(1).max(160).nullable().optional(),
});

type ErrorCode =
  | "bridge_disabled"
  | "unauthenticated"
  | "forbidden"
  | "validation_failed"
  | "conflict"
  | "not_found"
  | "internal_error";

const HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  bridge_disabled: 404,
  unauthenticated: 401,
  forbidden: 403,
  validation_failed: 400,
  conflict: 409,
  not_found: 404,
  internal_error: 500,
};

function fail(code: ErrorCode) {
  return NextResponse.json(
    { ok: false, error: { code } },
    { status: HTTP_STATUS[code], headers: { "Cache-Control": "private, no-store" } },
  );
}

function codeFromRpcError(error: unknown): ErrorCode {
  if (!(error instanceof TelegramChannelRpcError)) return "internal_error";
  if (error.failureCode === "P1101") return "unauthenticated";
  if (error.failureCode === "P1103") return "forbidden";
  if (error.failureCode === "P1104") return "not_found";
  if (error.failureCode === "P1109") return "conflict";
  if (error.failureCode === "P1111") return "validation_failed";
  return "internal_error";
}

export async function GET(request: Request) {
  if (!isTelegramBridgeEnabled()) return fail("bridge_disabled");

  const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
  if (!z.string().uuid().safeParse(projectId).success) return fail("validation_failed");

  try {
    const context = await createProjectCeoRequestContext();
    const inbox = await new TelegramInboxPort(context.client).listProjectInbox(projectId);
    return NextResponse.json(
      { ok: true, inbox },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof ProjectCeoAuthenticationError) return fail("unauthenticated");
    return fail(codeFromRpcError(error));
  }
}

export async function POST(request: Request) {
  if (!isTelegramBridgeEnabled()) return fail("bridge_disabled");
  if (!isSameOriginMutation(request)) return fail("forbidden");

  let body: z.infer<typeof reviewSchema>;
  try {
    body = reviewSchema.parse(await request.json());
  } catch {
    return fail("validation_failed");
  }

  try {
    const context = await createProjectCeoRequestContext();
    const result = await new TelegramInboxPort(context.client).reviewInboxCandidate({
      projectId: body.projectId,
      candidateId: body.candidateId,
      decision: body.decision,
      resultingEntityKind: body.resultingEntityKind ?? null,
      resultingEntityId: body.resultingEntityId ?? null,
    });
    return NextResponse.json(
      { ok: true, ...result },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof ProjectCeoAuthenticationError) return fail("unauthenticated");
    return fail(codeFromRpcError(error));
  }
}
