"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { sendProjectCeoCommand } from "@/components/projectceo/command-client";
import { ru } from "@/lib/i18n/ru";
import type { PassportApprovalProgress } from "@/lib/proposal/passport-approval";
import { getPassportApprovalProgress } from "./passport-approval-actions";

// Аудит 28.09, шаг 6: дизайнер сам подтверждает паспорт проекта перед
// отправкой КП. Это явное действие с отметкой, а не скрытый шаг «Отправить».
// Шаги — только через существующие authenticated-маршруты:
//   1. POST /api/projectceo/enroll — зачислить проект (идемпотентно);
//   2. /api/projectceo/commands — create → submit → decide(approved).
// Кто вправе утверждать, решает база (DEC-043): единственный владелец без
// архитектора с правом утверждения — может сам; иначе утверждает другой.

const strings = ru.proposal.passportApproval;
const REASON = "Дизайнер проверил паспорт проекта и подтвердил его перед отправкой КП";

type Failure = "forbidden" | "no_passport" | "failed";

async function enroll(projectId: string): Promise<boolean> {
  const response = await fetch("/api/projectceo/enroll", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contractVersion: "projectceo-enroll/0.1", projectId }),
  }).catch(() => null);
  if (!response) return false;
  const body = (await response.json().catch(() => null)) as { status?: string } | null;
  return body?.status === "completed";
}

async function command(
  projectId: string,
  kind: "create_approval_request" | "submit_approval_request" | "decide_approval_request",
  payload: Record<string, unknown>,
): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; code: string }> {
  const response = await sendProjectCeoCommand({
    contractVersion: "projectceo-command/0.1",
    kind,
    projectId,
    payload,
  } as Parameters<typeof sendProjectCeoCommand>[0]).catch(() => null);
  if (!response) return { ok: false, code: "internal_error" };
  if (response.status === "completed") return { ok: true, result: response.result as Record<string, unknown> };
  return { ok: false, code: response.error.code };
}

export default function PassportApproval({
  projectId,
  initial,
}: {
  readonly projectId: string;
  readonly initial: PassportApprovalProgress;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [approved, setApproved] = useState(initial.state === "approved");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();

  if (approved) {
    return <p role="status" className="mb-4 text-sm text-accent">{strings.done}</p>;
  }

  function confirm() {
    startTransition(async () => {
      setFailure(null);
      let progress = await getPassportApprovalProgress(projectId);
      if (progress.state === "not_enrolled") {
        if (!(await enroll(projectId))) return setFailure("failed");
        progress = await getPassportApprovalProgress(projectId);
      }
      if (progress.state === "approved") {
        setApproved(true);
        router.refresh();
        return;
      }
      if (progress.state !== "pending") return setFailure("failed");

      let requestId = progress.request?.requestId ?? null;
      let status = progress.request?.status ?? null;
      if (!requestId) {
        const created = await command(projectId, "create_approval_request", {
          subjectKind: "project_passport",
          subjectId: projectId,
          reason: REASON,
        });
        // Нет ревизии паспорта (бриф не отправлен) — база отвечает P1110.
        if (!created.ok) {
          return setFailure(["unsupported_source", "validation_failed"].includes(created.code) ? "no_passport" : "failed");
        }
        requestId = typeof created.result.requestId === "string" ? created.result.requestId : null;
        status = "draft";
        if (!requestId) return setFailure("failed");
      }
      if (status === "draft") {
        const submitted = await command(projectId, "submit_approval_request", { requestId });
        if (!submitted.ok) return setFailure("failed");
      }
      const decided = await command(projectId, "decide_approval_request", {
        requestId,
        decision: "approved",
        reason: REASON,
      });
      if (!decided.ok) return setFailure(decided.code === "forbidden" ? "forbidden" : "failed");
      setApproved(true);
      router.refresh();
    });
  }

  return (
    <section className="card mb-4 space-y-3" aria-labelledby="passport-approval-title">
      <h2 id="passport-approval-title" className="font-display text-xl font-semibold">{strings.title}</h2>
      <p className="text-sm text-muted">{strings.body}</p>
      <label className="flex items-start gap-2 text-sm" htmlFor="passport-approval-check">
        <input
          id="passport-approval-check"
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          className="mt-1"
        />
        {strings.checkbox}
      </label>
      <button type="button" className="btn-primary" disabled={!checked || pending} onClick={confirm}>
        {pending ? strings.working : strings.button}
      </button>
      {failure ? <p role="alert" className="text-sm text-red-700">{strings.errors[failure]}</p> : null}
    </section>
  );
}
