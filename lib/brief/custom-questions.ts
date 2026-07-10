import { z } from "zod";
import { QUESTIONS, type Option, type Question } from "@/lib/brief/questions";

export type CustomQuestionType = "text" | "choice" | "multi" | "number";
export type CustomQuestionSource = "manual" | "voice" | "llm" | "preset";

export interface CustomBriefQuestion {
  title: string;
  type: CustomQuestionType;
  help?: string;
  placeholder?: string;
  options?: Option[];
  source?: CustomQuestionSource;
  original_prompt?: string;
}

export interface QuestionPreset {
  id: string;
  label: string;
  description: string;
  questions: CustomBriefQuestion[];
}

const CUSTOM_QUESTION_TYPES = ["text", "choice", "multi", "number"] as const;

export const customBriefQuestionSchema = z
  .object({
    title: z.string().trim().min(5).max(220),
    type: z.enum(CUSTOM_QUESTION_TYPES).default("text"),
    help: z.string().trim().max(320).optional(),
    placeholder: z.string().trim().max(240).optional(),
    options: z
      .array(
        z
          .object({
            value: z.string().trim().min(1).max(48),
            label: z.string().trim().min(1).max(120),
          })
          .strict(),
      )
      .max(8)
      .optional(),
    source: z.enum(["manual", "voice", "llm", "preset"]).optional(),
    original_prompt: z.string().trim().max(500).optional(),
  })
  .strict();

export const llmStructuredQuestionSchema = z
  .object({
    title: z.string().trim().min(5).max(180),
    type: z.enum(CUSTOM_QUESTION_TYPES),
    help: z.string().trim().max(240).optional(),
    placeholder: z.string().trim().max(180).optional(),
    options: z
      .array(
        z
          .object({
            value: z.string().trim().min(1).max(40),
            label: z.string().trim().min(1).max(90),
          })
          .strict(),
      )
      .max(6)
      .optional(),
  })
  .strict();

export type LlmStructuredQuestion = z.infer<typeof llmStructuredQuestionSchema>;

function compactString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ") : undefined;
}

export function optionValueFromLabel(label: string, index = 0): string {
  const translit: Record<string, string> = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "e",
    ж: "zh",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ц: "c",
    ч: "ch",
    ш: "sh",
    щ: "sch",
    ы: "y",
    э: "e",
    ю: "yu",
    я: "ya",
  };
  const raw = label
    .toLowerCase()
    .replace(/[ъь]/g, "")
    .replace(/[а-яё]/g, (char) => translit[char] ?? "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  return raw || `option_${index + 1}`;
}

function cleanOptions(options: unknown): Option[] | undefined {
  if (!Array.isArray(options)) return undefined;
  const cleaned = options
    .map((item, index) => {
      if (typeof item === "string") {
        const label = compactString(item);
        return label ? { value: optionValueFromLabel(label, index), label } : null;
      }
      if (!item || typeof item !== "object") return null;
      const candidate = item as Record<string, unknown>;
      const label = compactString(candidate.label);
      if (!label) return null;
      const value = compactString(candidate.value) ?? optionValueFromLabel(label, index);
      return { value, label };
    })
    .filter((item): item is Option => Boolean(item))
    .slice(0, 8);
  return cleaned.length ? cleaned : undefined;
}

export function normalizeCustomQuestion(value: unknown): CustomBriefQuestion | null {
  if (typeof value === "string") {
    const title = compactString(value);
    return title ? { title, type: "text", source: "manual" } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const title = compactString(candidate.title);
  if (!title) return null;
  const type = CUSTOM_QUESTION_TYPES.includes(candidate.type as CustomQuestionType)
    ? (candidate.type as CustomQuestionType)
    : "text";
  const options = cleanOptions(candidate.options);
  const question: CustomBriefQuestion = {
    title,
    type: type === "choice" || type === "multi" ? (options ? type : "text") : type,
    help: compactString(candidate.help),
    placeholder: compactString(candidate.placeholder),
    options,
    source:
      candidate.source === "voice" ||
      candidate.source === "llm" ||
      candidate.source === "preset" ||
      candidate.source === "manual"
        ? candidate.source
        : "manual",
    original_prompt: compactString(candidate.original_prompt),
  };
  const parsed = customBriefQuestionSchema.safeParse(question);
  return parsed.success ? parsed.data : null;
}

export function normalizeCustomQuestions(value: unknown): CustomBriefQuestion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: CustomBriefQuestion[] = [];
  for (const raw of value) {
    const question = normalizeCustomQuestion(raw);
    if (!question) continue;
    const key = question.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(question);
  }
  return result.slice(0, 15);
}

export function customQuestionToRuntimeQuestion(question: CustomBriefQuestion, index: number): Question {
  return {
    id: `custom_${index}`,
    type: question.type,
    title: question.title,
    help: question.help,
    placeholder: question.placeholder,
    optional: true,
    passport_field: `custom_${index}`,
    options: question.options,
  };
}

export function formatCustomAnswer(question: CustomBriefQuestion, value: unknown): string {
  const optionLabel = (raw: unknown) => {
    const option = question.options?.find((item) => item.value === raw || item.label === raw);
    return option?.label ?? (typeof raw === "string" ? raw : "");
  };
  if (question.type === "multi" && Array.isArray(value)) {
    return value.map(optionLabel).filter(Boolean).join(", ");
  }
  if (question.type === "choice") return optionLabel(value);
  if (question.type === "number" && typeof value === "number") return String(value);
  return typeof value === "string" ? value : "";
}

export function sanitizeDesignerPrompt(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[контакт скрыт]")
    .replace(/(?:\+?7|8)[\s().-]*\d{3}[\s().-]*\d{2,3}[\s.-]*\d{2}[\s.-]*\d{2}/g, "[контакт скрыт]")
    .replace(/(^|\s)@[a-z0-9_]{3,}/gi, "$1[контакт скрыт]")
    .trim()
    .slice(0, 500);
}

export function fallbackQuestionFromPhrase(phrase: string, source: CustomQuestionSource = "manual"): CustomBriefQuestion {
  const clean = sanitizeDesignerPrompt(phrase).replace(/[.!。]+$/g, "");
  const title = clean.endsWith("?") ? clean : clean ? `${clean}?` : "Что важно уточнить перед проектом?";
  return {
    title,
    type: "text",
    help: "Свободный ответ дизайнера для уточнения перед первой встречей.",
    source,
    original_prompt: clean || undefined,
  };
}

export function buildCustomQuestionPrompt(phrase: string): string {
  const clean = sanitizeDesignerPrompt(phrase);
  return [
    "Ты помогаешь интерьерному дизайнеру превратить короткую голосовую или текстовую заметку в один вопрос для клиентского брифа.",
    "Верни только JSON по схеме:",
    '{"title":"string","type":"text|choice|multi|number","help":"string optional","placeholder":"string optional","options":[{"value":"slug","label":"string"}] optional}',
    "",
    "Правила:",
    "- язык: русский;",
    "- вопрос должен быть понятным клиенту, нейтральным и поведенческим;",
    "- не спрашивай про доход, паспортные данные, точный адрес, документы, оплату или договор;",
    "- если нужна шкала или варианты, используй choice/multi и 2-5 коротких options;",
    "- для свободного уточнения используй type=text;",
    "- для чисел используй type=number;",
    "- value у options: короткий латинский slug без пробелов;",
    "- не добавляй markdown и пояснения.",
    "",
    `Заметка дизайнера: ${clean}`,
  ].join("\n");
}

function fromQuestion(question: Question): CustomBriefQuestion | null {
  if (!["text", "choice", "multi", "number"].includes(question.type)) return null;
  return {
    title: question.title,
    type: question.type as CustomQuestionType,
    help: question.help,
    placeholder: question.placeholder,
    options: question.options,
    source: "preset",
  };
}

export const STANDARD_BRIEF_QUESTION_PREVIEW = QUESTIONS.map((question) => ({
  id: question.id,
  title: question.title,
  tier: question.tier ?? "deep",
}));

export const DESIGNER_QUESTION_PRESETS: QuestionPreset[] = [
  {
    id: "implementation",
    label: "Комплектация и реализация",
    description: "Для проектов, где дизайнеру важно заранее понять закупки, поставки и авторский надзор.",
    questions: [
      {
        title: "Какие решения вы хотите доверить дизайнеру на этапе закупок?",
        type: "multi",
        help: "Помогает понять, нужен ли формат с сопровождением.",
        options: [
          { value: "materials", label: "Материалы и отделка" },
          { value: "furniture", label: "Мебель" },
          { value: "lighting", label: "Свет" },
          { value: "equipment", label: "Техника и сантехника" },
          { value: "none", label: "Пока не знаю" },
        ],
        source: "preset",
      },
      {
        title: "Насколько вы готовы участвовать в согласованиях во время реализации?",
        type: "choice",
        options: [
          { value: "active", label: "Хочу участвовать активно" },
          { value: "key_points", label: "Только в ключевых решениях" },
          { value: "delegate", label: "Хочу максимально делегировать" },
        ],
        source: "preset",
      },
    ],
  },
  {
    id: "architecture",
    label: "Планировка и архитектура",
    description: "Для объектов с перепланировкой, техническими ограничениями и несколькими сценариями жизни.",
    questions: [
      fromQuestion(QUESTIONS.find((question) => question.id === "replanning")!)!,
      {
        title: "Какие стены, зоны или сценарии вы точно не хотите потерять при перепланировке?",
        type: "text",
        placeholder: "Например: отдельная спальня, закрытая кухня, место для рабочего стола.",
        source: "preset",
      },
    ],
  },
  {
    id: "family",
    label: "Семья и быт",
    description: "Для семейных проектов, где важны хранение, утро, дети, животные и износостойкость.",
    questions: [
      fromQuestion(QUESTIONS.find((question) => question.id === "morning")!)!,
      fromQuestion(QUESTIONS.find((question) => question.id === "storage")!)!,
      {
        title: "Какие бытовые сценарии сейчас создают больше всего хаоса?",
        type: "text",
        placeholder: "Например: сборы утром, хранение сезонных вещей, уроки детей, вещи у входа.",
        source: "preset",
      },
    ],
  },
];
