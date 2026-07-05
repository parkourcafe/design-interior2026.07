import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requestBaseUrl } from "@/lib/base-url";
import { ru } from "@/lib/i18n/ru";
import type { Passport } from "@/lib/types";
import { questionById } from "@/lib/brief/questions";
import { isProfileComplete } from "@/lib/designer";
import { getStudio } from "@/lib/studio";
import { missingFields, firstMeetingQuestions, type RiskCardRow } from "@/lib/review";
import PassportView from "@/components/passport-view";
import IntakeLink from "@/components/intake-link";
import CopyTextButton from "@/components/copy-text-button";
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

  const intakeUrl = `${requestBaseUrl()}/i/${p.intake_token}`;

  // Гейт: ссылку на бриф показываем только с заполненным профилем — клиент
  // должен видеть, от кого пришёл бриф (имя/студия + телефон + email).
  const studio = await getStudio();
  const profileReady = studio ? isProfileComplete(studio.designer) : false;

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
          {profileReady ? <IntakeLink url={intakeUrl} /> : <ProfileGate />}
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
        <ReviewBoard project={p} intakeUrl={intakeUrl} profileReady={profileReady} />
      )}
    </div>
  );
}

async function ReviewBoard({
  project,
  intakeUrl,
  profileReady,
}: {
  project: ProjectRow;
  intakeUrl: string;
  profileReady: boolean;
}) {
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

  // Голосовые/текстовые комментарии клиента к вопросам + загруженные файлы.
  const { data: extraRows } = await supabase
    .from("answers")
    .select("question_id, value")
    .eq("project_id", project.id)
    .in("question_id", ["comments", "attachments"]);
  const extraById = new Map(
    (extraRows ?? []).map((r) => [
      (r as { question_id: string }).question_id,
      (r as { value: unknown }).value,
    ]),
  );

  const commentsVal = extraById.get("comments");
  const comments: { title: string; text: string }[] =
    commentsVal && typeof commentsVal === "object" && !Array.isArray(commentsVal)
      ? Object.entries(commentsVal as Record<string, unknown>)
          .filter(([, t]) => typeof t === "string" && t.trim())
          .map(([qid, t]) => ({ title: questionById(qid)?.title ?? qid, text: String(t).trim() }))
      : [];

  const attachVal = extraById.get("attachments");
  const attachMeta = Array.isArray(attachVal)
    ? (attachVal as { path?: unknown; name?: unknown }[]).filter(
        (a) => a && typeof a.path === "string",
      )
    : [];
  let attachments: { name: string; url: string; isImage: boolean }[] = [];
  if (attachMeta.length > 0) {
    // Bucket приватный — подписываем ссылки service-role'ом (доступ к проекту
    // дизайнера уже проверен RLS выше).
    const admin = createAdminClient();
    const signed = await Promise.all(
      attachMeta.map(async (a) => {
        const path = a.path as string;
        const name = typeof a.name === "string" ? a.name : path.split("/").pop() ?? "файл";
        const { data } = await admin.storage.from("client-uploads").createSignedUrl(path, 3600);
        if (!data?.signedUrl) return null;
        return { name, url: data.signedUrl, isImage: /\.(png|jpe?g|webp|gif|heic)$/i.test(name) };
      }),
    );
    attachments = signed.filter(
      (x): x is { name: string; url: string; isImage: boolean } => x !== null,
    );
  }

  return (
    <div className="space-y-8">
      {profileReady ? <IntakeLink url={intakeUrl} /> : <ProfileGate />}

      {llmDegraded && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {ru.review.degraded}
        </p>
      )}

      <section>
        <h2 className="mb-3 font-display text-2xl font-semibold">{ru.review.passport}</h2>
        <PassportView passport={passport} />
      </section>

      {attachments.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-2xl font-semibold">
            Файлы клиента <span className="text-base font-normal text-muted">({attachments.length})</span>
          </h2>
          <div className="card grid grid-cols-2 gap-3 sm:grid-cols-3">
            {attachments.map((f) => (
              <a
                key={f.url}
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group block overflow-hidden rounded-lg border border-line hover:border-ink/30"
              >
                {f.isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- подписанный URL из Storage
                  <img src={f.url} alt={f.name} className="aspect-square w-full object-cover" />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center bg-line/30 text-3xl">
                    📄
                  </div>
                )}
                <span className="block truncate px-2 py-1.5 text-xs text-muted group-hover:text-ink">
                  {f.name}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {comments.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-2xl font-semibold">Комментарии клиента</h2>
          <div className="card space-y-3">
            {comments.map((c, i) => (
              <div key={i}>
                <p className="text-xs uppercase tracking-wide text-muted">{c.title}</p>
                <p className="mt-0.5 whitespace-pre-line text-sm text-ink/90">{c.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

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
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold">{ru.review.questions}</h2>
            {questions.length > 0 && (
              <CopyTextButton
                text={questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}
                label="Скопировать"
              />
            )}
          </div>
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

// Гейт: пока профиль не заполнен, вместо ссылки на бриф — призыв заполнить.
function ProfileGate() {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
      <h3 className="font-medium text-amber-900">{ru.profileGate.title}</h3>
      <p className="mt-1 text-sm text-amber-900/80">{ru.profileGate.text}</p>
      <Link href="/dashboard/setup" className="btn-primary mt-3 inline-flex">
        {ru.profileGate.cta}
      </Link>
    </div>
  );
}
