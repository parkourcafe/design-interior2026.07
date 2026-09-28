import { z } from "zod";
import { QUESTIONS, type Question } from "@/lib/brief/questions";
import { customQuestionToRuntimeQuestion, type CustomBriefQuestion } from "@/lib/brief/custom-questions";
import type { AnswersMap } from "@/lib/types";

// Проверка ответов брифа на сервере (аудит 28.09, шаг 4). Клиент по публичной
// ссылке может прислать что угодно, поэтому принимается только то, что мастер
// брифа сам умеет записать:
//   * id вопросов из QUESTIONS (кроме файлов — их пишет маршрут загрузки);
//   * свои вопросы дизайнера custom_0..custom_{n-1} этого проекта;
//   * comments — комментарии к этим вопросам.
// Служебные ключи (attachments, designer_*) и любые другие отклоняются: через
// них подменялись вложения, а политика хранилища выдавала файлы по путям из
// ответов.

export const MAX_SUBMIT_BODY_BYTES = 64 * 1024;
const TEXT_MAX = 4000;
const SHORT_MAX = 200;
const COMMENT_MAX = 2000;

const shortText = z.string().max(SHORT_MAX);
const optionalFiniteNumber = (min: number, max: number) =>
  z.number().finite().min(min).max(max).optional();

const objectSchema = z.object({
  type: z.enum(["flat", "house", "apartments"]).optional(),
  area_m2: optionalFiniteNumber(0, 100_000),
  city: shortText.optional(),
  district: shortText.optional(),
  floor: optionalFiniteNumber(-10, 500),
  building: shortText.optional(),
}).strict();

const budgetSchema = z.object({
  range: z.union([
    z.literal("undisclosed"),
    z.tuple([z.number().int().min(0).max(10_000_000_000), z.number().int().min(0).max(10_000_000_000)]),
  ]),
}).strict();

const styleSchema = z.object({
  refs: z.array(z.string().max(1000)).max(20).optional(),
  anti: z.array(z.string().max(SHORT_MAX)).max(50).optional(),
  notes: z.string().max(TEXT_MAX).optional(),
}).strict();

const contactSchema = z.object({
  name: shortText.optional(),
  phone: z.string().max(50).optional(),
  email: z.string().max(SHORT_MAX).optional(),
  consent: z.boolean().optional(),
}).strict();

function schemaFor(question: Question): z.ZodTypeAny | null {
  const values = (question.options ?? []).map((option) => option.value);
  switch (question.type) {
    case "object":
      return objectSchema;
    case "budget":
      return budgetSchema;
    case "style":
      return styleSchema;
    case "contact":
      return contactSchema;
    case "text":
      return z.string().max(TEXT_MAX);
    case "number":
      return z.number().finite().min(0).max(1_000_000);
    case "choice":
      return values.length > 0 ? z.string().refine((value) => values.includes(value)) : shortText;
    case "multi":
      return values.length > 0
        ? z.array(z.string().refine((value) => values.includes(value))).max(values.length)
        : z.array(shortText).max(50);
    case "files":
      return null;
    default:
      return null;
  }
}

export type AnswerValidation =
  | { readonly ok: true; readonly answers: AnswersMap; readonly consent: boolean }
  | { readonly ok: false; readonly error: "invalid_answers"; readonly field: string };

export function validateSubmittedAnswers(
  raw: unknown,
  customQuestions: readonly CustomBriefQuestion[],
): AnswerValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "invalid_answers", field: "answers" };
  }
  const allowed = new Map<string, Question>();
  for (const question of QUESTIONS) allowed.set(question.id, question);
  customQuestions.forEach((question, index) => {
    const runtime = customQuestionToRuntimeQuestion(question, index);
    allowed.set(runtime.id, runtime);
  });

  const answers: AnswersMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    if (key === "comments") {
      const comments = z.record(z.string().max(COMMENT_MAX)).safeParse(value);
      if (!comments.success || Object.keys(comments.data).some((id) => !allowed.has(id))) {
        return { ok: false, error: "invalid_answers", field: "comments" };
      }
      answers.comments = comments.data as AnswersMap[string];
      continue;
    }
    const question = allowed.get(key);
    const schema = question ? schemaFor(question) : null;
    if (!schema) return { ok: false, error: "invalid_answers", field: key };
    const parsed = schema.safeParse(value);
    if (!parsed.success) return { ok: false, error: "invalid_answers", field: key };
    answers[key] = parsed.data as AnswersMap[string];
  }

  const contact = answers.contact as { consent?: boolean } | undefined;
  return { ok: true, answers, consent: contact?.consent === true };
}
