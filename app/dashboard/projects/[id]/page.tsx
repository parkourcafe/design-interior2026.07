import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/env";
import { ru } from "@/lib/i18n/ru";
import type { Passport } from "@/lib/types";
import { missingFields, firstMeetingQuestions, type RiskCardRow } from "@/lib/review";
import PassportView from "@/components/passport-view";
import IntakeLink from "@/components/intake-link";
import ReviewCards from "./review";
import CustomQuestions from "./custom-questions";

export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  client_name: string;
  status: string;
  intake_token: string;
  passport: Passport | null;
  custom_questions: string[];
}

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, client_name, status, intake_token, passport, custom_questions")
    .eq("id", params.id)
    .maybeSingle();

  if (!project) notFound();
  const p = project as ProjectRow;

  const briefDone = Boolean(
    p.passport &&
      ["brief_completed", "proposal_draft", "proposal_sent"].includes(p.status),
  );

  const intakeUrl = `${appUrl()}/i/${p.intake_token}`;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="text-sm text-muted hover:text-ink">
            ← {ru.projects.title}
          </Link>
          <h1 className="mt-1 font-display text-3xl font-semibold">{p.client_name}</h1>
        </div>
        <span className="rounded-full bg-line/50 px-3 py-1 text-xs text-muted">
          {ru.projects.statusLabel[p.status] ?? p.status}
        </span>
      </div>

      {!briefDone ? (
        <div className="space-y-4">
          <IntakeLink url={intakeUrl} />
          <CustomQuestions
            projectId={p.id}
            initial={Array.isArray(p.custom_questions) ? p.custom_questions : []}
          />
          <p className="text-sm text-muted">
            Ждём, пока клиент заполнит бриф. Как только он завершит — здесь появятся паспорт
            проекта и карточки рисков.
          </p>
        </div>
      ) : (
        <ReviewBoard project={p} intakeUrl={intakeUrl} />
      )}
    </div>
  );
}

async function ReviewBoard({ project, intakeUrl }: { project: ProjectRow; intakeUrl: string }) {
  const supabase = createClient();
  const { data: cardRows } = await supabase
    .from("risk_cards")
    .select("id, risk_type, evidence, impact, confidence, designer_action, proposal_implication, status, source")
    .eq("project_id", project.id)
    .order("source", { ascending: true });

  const cards = (cardRows ?? []) as RiskCardRow[];
  const passport = project.passport!;
  const missing = missingFields(passport);
  const questions = firstMeetingQuestions(cards);
  const llmDegraded = cards.length > 0 && cards.every((c) => c.source === "rule");

  // Ответы клиента на свои вопросы дизайнера (question_id = custom_0, custom_1…).
  const customQ = Array.isArray(project.custom_questions) ? project.custom_questions : [];
  let customAnswers: { q: string; a: string }[] = [];
  if (customQ.length > 0) {
    const { data: answerRows } = await supabase
      .from("answers")
      .select("question_id, value")
      .eq("project_id", project.id)
      .like("question_id", "custom_%");
    const byId = new Map(
      (answerRows ?? []).map((r) => [
        (r as { question_id: string }).question_id,
        (r as { value: unknown }).value,
      ]),
    );
    customAnswers = customQ.map((q, i) => ({
      q,
      a: typeof byId.get(`custom_${i}`) === "string" ? String(byId.get(`custom_${i}`)) : "",
    }));
  }

  return (
    <div className="space-y-8">
      <IntakeLink url={intakeUrl} />

      {llmDegraded && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {ru.review.degraded}
        </p>
      )}

      <section>
        <h2 className="mb-3 font-display text-2xl font-semibold">{ru.review.passport}</h2>
        <PassportView passport={passport} />
      </section>

      {customAnswers.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-2xl font-semibold">Ответы на ваши вопросы</h2>
          <div className="card space-y-3">
            {customAnswers.map((qa, i) => (
              <div key={i}>
                <p className="text-sm font-medium">{qa.q}</p>
                <p className="text-sm text-muted">{qa.a || "— клиент не ответил"}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-display text-2xl font-semibold">{ru.review.risks}</h2>
        <ReviewCards projectId={project.id} cards={cards} />
      </section>

      <div className="grid gap-6 sm:grid-cols-2">
        <section>
          <h2 className="mb-3 font-display text-2xl font-semibold">{ru.review.missing}</h2>
          {missing.length === 0 ? (
            <p className="text-sm text-muted">{ru.review.missingEmpty}</p>
          ) : (
            <ul className="card list-disc space-y-1 pl-8 text-sm">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 font-display text-2xl font-semibold">{ru.review.questions}</h2>
          {questions.length === 0 ? (
            <p className="text-sm text-muted">{ru.review.questionsEmpty}</p>
          ) : (
            <ul className="card list-disc space-y-1 pl-8 text-sm">
              {questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div>
        <Link href={`/dashboard/projects/${project.id}/proposal`} className="btn-primary">
          {ru.review.buildProposal}
        </Link>
      </div>
    </div>
  );
}
