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
// Отказ (400) — только за служебные и незнакомые ключи (attachments, designer_*
// и т.п.): через них подменялись вложения, а политика хранилища выдавала файлы
// по путям из ответов. Всё, что может прийти от настоящего клиента, не
// отклоняется, а приводится в порядок, иначе черновик брифа в браузере клиента
// навсегда перестаёт отправляться:
//   * слишком длинный текст обрезается до лимита;
//   * пустые ячейки референсов (мастер пишет их по индексу) убираются;
//   * ответы и комментарии к своим вопросам, которые дизайнер уже удалил или
//     изменил, пока клиент заполнял бриф, тихо отбрасываются.

export const MAX_SUBMIT_BODY_BYTES = 256 * 1024;
const TEXT_MAX = 4000;
const SHORT_MAX = 200;
const COMMENT_MAX = 2000;
const CUSTOM_ID = /^custom_\d{1,3}$/;

const text = (max: number) => z.string().transform((value) => value.slice(0, max));
const shortText = text(SHORT_MAX);
const optionalFiniteNumber = (min: number, max: number) =>
  z.number().finite().min(min).max(max).optional();
// Мастер пишет референсы по индексу: пропущенная ячейка приходит как null.
const textList = (max: number, items: number) =>
  z.array(z.string().nullable()).transform((list) =>
    list.filter((item): item is string => typeof item === "string" && item.trim() !== "")
      .slice(0, items)
      .map((item) => item.slice(0, max)));

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
  refs: textList(1000, 20).optional(),
  anti: textList(SHORT_MAX, 50).optional(),
  notes: text(TEXT_MAX).optional(),
}).strict();

const contactSchema = z.object({
  name: shortText.optional(),
  phone: text(50).optional(),
  email: shortText.optional(),
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
      return text(TEXT_MAX);
    case "number":
      return z.number().finite().min(0).max(1_000_000_000_000);
    case "choice":
      return values.length > 0 ? z.string().refine((value) => values.includes(value)) : shortText;
    case "multi":
      return values.length > 0
        ? z.array(z.string()).transform((list) => [...new Set(list.filter((value) => values.includes(value)))])
            .refine((list) => list.length > 0)
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
      // Комментарии — только строки к существующим вопросам; устаревшие
      // (вопрос дизайнера удалён) отбрасываются.
      if (typeof value !== "object" || Array.isArray(value)) continue;
      const comments: Record<string, string> = {};
      for (const [id, comment] of Object.entries(value as Record<string, unknown>)) {
        if (allowed.has(id) && typeof comment === "string" && comment.trim() !== "") {
          comments[id] = comment.slice(0, COMMENT_MAX);
        }
      }
      if (Object.keys(comments).length > 0) answers.comments = comments as AnswersMap[string];
      continue;
    }
    const question = allowed.get(key);
    const schema = question ? schemaFor(question) : null;
    if (!schema) {
      // Свой вопрос, которого у проекта уже нет, — устаревший черновик клиента.
      if (CUSTOM_ID.test(key)) continue;
      return { ok: false, error: "invalid_answers", field: key };
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      // Дизайнер поменял тип или варианты своего вопроса — ответ устарел.
      if (CUSTOM_ID.test(key)) continue;
      return { ok: false, error: "invalid_answers", field: key };
    }
    answers[key] = parsed.data as AnswersMap[string];
  }

  const contact = answers.contact as { consent?: boolean } | undefined;
  return { ok: true, answers, consent: contact?.consent === true };
}
