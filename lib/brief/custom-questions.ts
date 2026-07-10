import { z } from "zod";
import { QUESTIONS, type Option, type Question } from "@/lib/brief/questions";

export type CustomQuestionType = "text" | "choice" | "multi" | "number";
export type CustomQuestionSource = "manual" | "voice" | "llm" | "preset";
export type PlanAssistedFactDiscipline =
  | "metadata"
  | "site"
  | "planning"
  | "engineering"
  | "facade"
  | "signage"
  | "constraints";
export type PlanAssistedFactSource = "description" | "plan_notes" | "file_name" | "file_text" | "metadata";
export type PlanTextExtractionStatus = "text_extracted" | "no_text" | "unsupported" | "failed";
export type PlanTextExtractionSource = "pdf_text" | "plain_text" | "vision_ocr" | "zai_ocr" | "none";
export type PlanAssistedFactStatus = "proposed" | "confirmed" | "rejected";
export type BriefPackProjectType =
  | "residential"
  | "commercial"
  | "wellness"
  | "restaurant"
  | "office"
  | "retail"
  | "hospitality"
  | "other";

export const CUSTOM_QUESTIONS_LIMIT = 100;
export const BRIEF_PACK_PROJECT_TYPES = [
  "residential",
  "commercial",
  "wellness",
  "restaurant",
  "office",
  "retail",
  "hospitality",
  "other",
] as const;

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

export interface BriefPackPlanFile {
  name: string;
  size?: number;
  type?: string;
  path?: string;
  text_excerpt?: string;
  text_extraction?: {
    status: PlanTextExtractionStatus;
    source: PlanTextExtractionSource;
    chars: number;
    message?: string;
  };
}

export interface PlanAssistedFact {
  id: string;
  label: string;
  value: string;
  discipline: PlanAssistedFactDiscipline;
  confidence: "low" | "medium" | "high";
  evidence: string;
  source: PlanAssistedFactSource;
  status?: PlanAssistedFactStatus;
}

export interface BriefPackContext {
  project_type: BriefPackProjectType;
  description: string;
  area_m2?: number | null;
  location?: string;
  plan_notes?: string;
  plan_files?: BriefPackPlanFile[];
  plan_facts?: PlanAssistedFact[];
}

const CUSTOM_QUESTION_TYPES = ["text", "choice", "multi", "number"] as const;
const PLAN_ASSISTED_FACT_DISCIPLINES = [
  "metadata",
  "site",
  "planning",
  "engineering",
  "facade",
  "signage",
  "constraints",
] as const;
const PLAN_ASSISTED_FACT_SOURCES = ["description", "plan_notes", "file_name", "file_text", "metadata"] as const;
const PLAN_ASSISTED_FACT_STATUSES = ["proposed", "confirmed", "rejected"] as const;
const PLAN_TEXT_EXTRACTION_STATUSES = ["text_extracted", "no_text", "unsupported", "failed"] as const;
const PLAN_TEXT_EXTRACTION_SOURCES = ["pdf_text", "plain_text", "vision_ocr", "zai_ocr", "none"] as const;

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

export const briefPackPlanFileSchema = z
  .object({
    name: z.string().trim().min(1).max(180),
    size: z.number().int().nonnegative().max(25 * 1024 * 1024).optional(),
    type: z.string().trim().max(120).optional(),
    path: z.string().trim().max(300).optional(),
    text_excerpt: z.string().trim().max(3000).optional(),
    text_extraction: z
      .object({
        status: z.enum(PLAN_TEXT_EXTRACTION_STATUSES),
        source: z.enum(PLAN_TEXT_EXTRACTION_SOURCES),
        chars: z.number().int().nonnegative().max(1_000_000),
        message: z.string().trim().max(120).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const planAssistedFactSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(2).max(120),
    value: z.string().trim().min(1).max(260),
    discipline: z.enum(PLAN_ASSISTED_FACT_DISCIPLINES),
    confidence: z.enum(["low", "medium", "high"]),
    evidence: z.string().trim().min(1).max(260),
    source: z.enum(PLAN_ASSISTED_FACT_SOURCES),
    status: z.enum(PLAN_ASSISTED_FACT_STATUSES).optional(),
  })
  .strict();

export const planAssistedDraftSchema = z
  .object({
    summary: z.string().trim().max(500),
    facts: z.array(planAssistedFactSchema).max(30),
  })
  .strict();

export const briefPackContextSchema = z
  .object({
    project_type: z.enum(BRIEF_PACK_PROJECT_TYPES),
    description: z.string().trim().min(5).max(1000),
    area_m2: z.number().positive().max(100000).nullable().optional(),
    location: z.string().trim().max(120).optional(),
    plan_notes: z.string().trim().max(1000).optional(),
    plan_files: z.array(briefPackPlanFileSchema).max(5).optional(),
    plan_facts: z.array(planAssistedFactSchema).max(30).optional(),
  })
  .strict();

export const briefPackSchema = z
  .object({
    groups: z
      .array(
        z
          .object({
            title: z.string().trim().min(3).max(90),
            questions: z.array(llmStructuredQuestionSchema).min(1).max(6),
          })
          .strict(),
      )
      .min(2)
      .max(8),
  })
  .strict();

export type BriefPack = z.infer<typeof briefPackSchema>;

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
  return result.slice(0, CUSTOM_QUESTIONS_LIMIT);
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

function sanitizeBriefPackContext(context: BriefPackContext): BriefPackContext {
  const parsed = briefPackContextSchema.safeParse({
    ...context,
    description: sanitizeDesignerPrompt(context.description).slice(0, 1000),
    location: compactString(context.location)?.slice(0, 120),
    plan_notes: context.plan_notes ? sanitizeDesignerPrompt(context.plan_notes).slice(0, 1000) : undefined,
    plan_files: context.plan_files?.map((file) => ({
      name: compactString(file.name)?.slice(0, 180) ?? "файл",
      size: typeof file.size === "number" ? file.size : undefined,
      type: compactString(file.type)?.slice(0, 120),
      path: compactString(file.path)?.slice(0, 300),
      text_excerpt: compactString(file.text_excerpt)?.slice(0, 3000),
      text_extraction: file.text_extraction
        ? {
            status: file.text_extraction.status,
            source: file.text_extraction.source,
            chars: file.text_extraction.chars,
            message: compactString(file.text_extraction.message)?.slice(0, 120),
          }
        : undefined,
    })),
    plan_facts: context.plan_facts
      ?.filter((fact) => fact.status !== "rejected")
      .map((fact) => ({
        id: compactString(fact.id)?.slice(0, 80) ?? "fact",
        label: compactString(fact.label)?.slice(0, 120) ?? "Факт",
        value: compactString(fact.value)?.slice(0, 260) ?? "",
        discipline: fact.discipline,
        confidence: fact.confidence,
        evidence: compactString(fact.evidence)?.slice(0, 260) ?? "Подтверждено дизайнером",
        source: fact.source,
        status: fact.status ?? "confirmed",
      })),
  });
  if (parsed.success) return parsed.data;
  return {
    project_type: "other",
    description: sanitizeDesignerPrompt(context.description || "Проект без подробного описания"),
  };
}

export function buildBriefPackPrompt(context: BriefPackContext): string {
  const clean = sanitizeBriefPackContext(context);
  const hasPlans = Boolean(clean.plan_files?.length || clean.plan_notes);
  const confirmedFacts = (clean.plan_facts ?? []).filter((fact) => fact.status !== "rejected");
  return [
    "Ты помогаешь интерьерному дизайнеру подготовить дополнительные вопросы для клиентского брифа по описанию проекта.",
    "Верни только JSON по схеме:",
    '{"groups":[{"title":"string","questions":[{"title":"string","type":"text|choice|multi|number","help":"string optional","placeholder":"string optional","options":[{"value":"slug","label":"string"}] optional}]}]}',
    "",
    "Правила:",
    "- язык: русский;",
    "- всего 8-14 вопросов, сгруппированных в 3-6 блоков;",
    "- вопросы должны быть понятными клиенту, нейтральными и поведенческими;",
    "- используй только типы text, choice, multi, number;",
    "- для choice/multi дай 2-5 коротких options, value — латинский slug без пробелов;",
    "- не спрашивай про доход, паспортные данные, точный адрес, документы, оплату или договор;",
    "- не добавляй вопросы, которые полностью дублируют стандартный бриф: тип объекта, площадь, город, бюджетный коридор, срок, стиль, боли;",
    "- если проект коммерческий, уточняй операционную модель, путь клиента, зоны, персонал, хранение, инженерные ограничения, акустику/приватность, материалы, согласования и запуск;",
    "- если данных мало, добавь вопросы, которые помогут снять неопределенность, а не придумывай факты;",
    confirmedFacts.length
      ? "- используй plan_facts как подтверждённые дизайнером факты по плану; не делай выводов сверх этих фактов, а превращай их в уточняющие вопросы."
      : hasPlans
        ? "- план/файлы переданы как метаданные и заметки; не утверждай, что прочитал чертёж, задай проверочные вопросы по входам, мокрым точкам, несущим стенам, высотам и масштабу."
        : "- если план не передан, можно спросить, что уже известно по планировочным и инженерным ограничениям.",
    "- не добавляй markdown и пояснения.",
    "",
    `Контекст проекта: ${JSON.stringify(clean)}`,
  ].join("\n");
}

function groupHelp(groupTitle: string, help?: string): string {
  const value = compactString(help);
  return value ? `Блок: ${groupTitle}. ${value}`.slice(0, 320) : `Блок: ${groupTitle}.`;
}

export function flattenBriefPack(pack: BriefPack): CustomBriefQuestion[] {
  return normalizeCustomQuestions(
    pack.groups.flatMap((group) =>
      group.questions.map((question) => ({
        ...question,
        help: groupHelp(group.title, question.help),
        source: "llm",
      })),
    ),
  );
}

function planVerificationQuestions(context: BriefPackContext): CustomBriefQuestion[] {
  const facts = (context.plan_facts ?? []).filter((fact) => fact.status !== "rejected");
  const factQuestions = facts
    .flatMap((fact): CustomBriefQuestion[] => {
      if (fact.discipline === "site" || fact.discipline === "constraints") {
        return [
          {
            title: `Как факт «${fact.value}» должен повлиять на планировку, приватность или сценарии использования?`,
            type: "text",
            help: `Из плана/заметок: ${fact.evidence}`,
            source: "llm",
          },
        ];
      }
      if (fact.discipline === "engineering") {
        return [
          {
            title: `Какие ограничения по инженерии нужно проверить для зоны или системы «${fact.value}»?`,
            type: "text",
            help: `Из плана/заметок: ${fact.evidence}`,
            source: "llm",
          },
        ];
      }
      if (fact.discipline === "planning") {
        return [
          {
            title: `Как клиент планирует использовать зону «${fact.value}» в обычный день и при гостях?`,
            type: "text",
            help: `Из плана/заметок: ${fact.evidence}`,
            source: "llm",
          },
        ];
      }
      return [];
    })
    .slice(0, 6);

  if (factQuestions.length > 0) return factQuestions;
  if (!context.plan_files?.length && !context.plan_notes) return [];
  return [
    {
      title: "Что на плане уже точно зафиксировано и не подлежит изменению?",
      type: "text",
      help: "Например: входы, мокрые точки, несущие стены, окна, технические шахты.",
      placeholder: "Опишите ограничения по плану своими словами.",
      source: "llm",
    },
    {
      title: "Какие размеры, высоты или инженерные точки на плане нужно проверить до планировочного решения?",
      type: "text",
      help: "Файл хранится как контекст, без автоматического распознавания чертежа.",
      placeholder: "Например: высота потолка, выводы воды, вентиляция, электрика, уклоны.",
      source: "llm",
    },
  ];
}

function wellnessFallbackQuestions(): CustomBriefQuestion[] {
  return [
    {
      title: "Какие типы процедур должна поддерживать студия на первом запуске?",
      type: "multi",
      options: [
        { value: "massage", label: "Массаж" },
        { value: "spa", label: "SPA-процедуры" },
        { value: "face_body", label: "Уход за лицом и телом" },
        { value: "retail", label: "Продажа косметики" },
        { value: "other", label: "Другое" },
      ],
      source: "llm",
    },
    {
      title: "Сколько процедурных кабинетов или рабочих мест нужно одновременно?",
      type: "number",
      help: "Помогает оценить плотность планировки и нагрузку на инженерные системы.",
      source: "llm",
    },
    {
      title: "Каким должен быть путь гостя от входа до выхода?",
      type: "text",
      placeholder: "Например: ресепшен, ожидание, переодевание, процедура, душ, чайная зона, оплата.",
      source: "llm",
    },
    {
      title: "Какие зоны обязательны для работы студии?",
      type: "multi",
      options: [
        { value: "reception", label: "Ресепшен" },
        { value: "waiting", label: "Зона ожидания" },
        { value: "treatment_rooms", label: "Кабинеты" },
        { value: "showers", label: "Душевые" },
        { value: "staff", label: "Комната персонала" },
        { value: "laundry_storage", label: "Прачечная и хранение" },
      ],
      source: "llm",
    },
    {
      title: "Сколько сотрудников одновременно находится в смене?",
      type: "number",
      help: "Нужно для бытовых зон, хранения, раздевалки и графика движения.",
      source: "llm",
    },
    {
      title: "Какие инженерные ограничения уже известны по объекту?",
      type: "multi",
      options: [
        { value: "plumbing", label: "Вода и канализация" },
        { value: "hvac", label: "Вентиляция и кондиционирование" },
        { value: "electricity", label: "Электрика" },
        { value: "acoustics", label: "Акустика" },
        { value: "unknown", label: "Пока неизвестно" },
      ],
      source: "llm",
    },
    {
      title: "Какой уровень приватности и звукоизоляции нужен между кабинетами?",
      type: "choice",
      options: [
        { value: "basic", label: "Базовый" },
        { value: "comfortable", label: "Комфортный" },
        { value: "high", label: "Высокий" },
        { value: "unknown", label: "Нужно обсудить" },
      ],
      source: "llm",
    },
    {
      title: "Какие материалы или поверхности должны быть особенно износостойкими и простыми в уборке?",
      type: "text",
      placeholder: "Например: полы, стены кабинетов, мокрые зоны, ресепшен, мебель.",
      source: "llm",
    },
    {
      title: "Какое ощущение бренда должен получить гость в первые 30 секунд?",
      type: "text",
      placeholder: "Например: премиально, спокойно, тропически, медицински чисто, камерно.",
      source: "llm",
    },
    {
      title: "Кто будет принимать решения по операционным и визуальным вопросам?",
      type: "choice",
      options: [
        { value: "owner", label: "Собственник" },
        { value: "manager", label: "Операционный управляющий" },
        { value: "team", label: "Несколько участников" },
        { value: "unknown", label: "Пока не определено" },
      ],
      source: "llm",
    },
  ];
}

function commercialFallbackQuestions(): CustomBriefQuestion[] {
  return [
    {
      title: "Какая бизнес-задача у пространства на первый год работы?",
      type: "text",
      placeholder: "Например: быстрый запуск, премиальный образ, высокая пропускная способность.",
      source: "llm",
    },
    {
      title: "Какие группы пользователей будут находиться в пространстве одновременно?",
      type: "multi",
      options: [
        { value: "clients", label: "Клиенты" },
        { value: "staff", label: "Персонал" },
        { value: "partners", label: "Партнёры" },
        { value: "delivery", label: "Доставка/сервис" },
      ],
      source: "llm",
    },
    {
      title: "Какие зоны критичны для запуска, а какие можно отложить?",
      type: "text",
      source: "llm",
    },
    {
      title: "Какие процессы должны быть незаметны для клиента?",
      type: "text",
      placeholder: "Например: хранение, уборка, доставка, персонал, техническое обслуживание.",
      source: "llm",
    },
    {
      title: "Какие инженерные вопросы нужно проверить до концепции?",
      type: "multi",
      options: [
        { value: "ventilation", label: "Вентиляция" },
        { value: "water", label: "Вода/канализация" },
        { value: "power", label: "Мощность электрики" },
        { value: "fire", label: "Пожарные требования" },
        { value: "unknown", label: "Пока неизвестно" },
      ],
      source: "llm",
    },
    {
      title: "Какой уровень готовности нужен от дизайнера: концепция, рабочая документация или сопровождение запуска?",
      type: "choice",
      options: [
        { value: "concept", label: "Концепция" },
        { value: "documentation", label: "Рабочая документация" },
        { value: "launch_support", label: "Сопровождение запуска" },
        { value: "unknown", label: "Нужно подобрать" },
      ],
      source: "llm",
    },
    {
      title: "Есть ли требования арендодателя, управляющей компании или площадки?",
      type: "text",
      source: "llm",
    },
    {
      title: "Какие решения должны быть простыми в обслуживании после открытия?",
      type: "text",
      placeholder: "Материалы, мебель, свет, оборудование, навигация, хранение.",
      source: "llm",
    },
  ];
}

function residentialFallbackQuestions(): CustomBriefQuestion[] {
  return [
    {
      title: "Какие сценарии жизни в этом объекте важнее всего сохранить?",
      type: "text",
      placeholder: "Например: тихое утро, гости, работа дома, хранение, спорт.",
      source: "llm",
    },
    {
      title: "Какие зоны должны быть готовы в первую очередь?",
      type: "multi",
      options: [
        { value: "kitchen", label: "Кухня" },
        { value: "bedroom", label: "Спальня" },
        { value: "kids", label: "Детская" },
        { value: "bathrooms", label: "Санузлы" },
        { value: "storage", label: "Хранение" },
      ],
      source: "llm",
    },
    {
      title: "Какие решения вы готовы доверить дизайнеру без частых согласований?",
      type: "multi",
      options: [
        { value: "planning", label: "Планировка" },
        { value: "materials", label: "Материалы" },
        { value: "furniture", label: "Мебель" },
        { value: "lighting", label: "Свет" },
        { value: "none", label: "Пока ничего" },
      ],
      source: "llm",
    },
    {
      title: "Какие бытовые ограничения нельзя нарушить в проекте?",
      type: "text",
      placeholder: "Например: сон ребёнка, животные, удалённая работа, аллергии, много вещей.",
      source: "llm",
    },
    {
      title: "Нужна ли помощь на этапе закупок и реализации?",
      type: "choice",
      options: [
        { value: "no", label: "Нет, только проект" },
        { value: "key_points", label: "Только ключевые решения" },
        { value: "full", label: "Да, хочу сопровождение" },
        { value: "unknown", label: "Пока не знаю" },
      ],
      source: "llm",
    },
  ];
}

export function fallbackBriefPackFromContext(context: BriefPackContext): CustomBriefQuestion[] {
  const clean = sanitizeBriefPackContext(context);
  const isWellness =
    clean.project_type === "wellness" ||
    /массаж|spa|спа|wellness|велнес|салон|процедур/i.test(clean.description);
  const commercialTypes: BriefPackProjectType[] = [
    "commercial",
    "restaurant",
    "office",
    "retail",
    "hospitality",
  ];
  const base = isWellness
    ? wellnessFallbackQuestions()
    : commercialTypes.includes(clean.project_type)
      ? commercialFallbackQuestions()
      : residentialFallbackQuestions();
  const areaQuestion: CustomBriefQuestion | null = clean.area_m2
    ? {
        title: `Какие зоны должны поместиться в ${clean.area_m2} м² без компромисса по работе пространства?`,
        type: "text",
        help: "Помогает связать площадь с приоритетами клиента.",
        source: "llm",
      }
    : null;
  const locationQuestion: CustomBriefQuestion | null = clean.location
    ? {
        title: `Какие особенности локации «${clean.location}» важно учесть в проекте?`,
        type: "text",
        placeholder: "Климат, влажность, поставки, местные ограничения, ожидания гостей.",
        source: "llm",
      }
    : null;

  return normalizeCustomQuestions([
    ...base,
    areaQuestion,
    locationQuestion,
    ...planVerificationQuestions(clean),
  ]);
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
