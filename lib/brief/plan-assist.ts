import { z } from "zod";
import {
  BRIEF_PACK_PROJECT_TYPES,
  briefPackPlanFileSchema,
  optionValueFromLabel,
  planAssistedDraftSchema,
  sanitizeDesignerPrompt,
  type BriefPackPlanFile,
  type BriefPackProjectType,
  type PlanAssistedFact,
  type PlanAssistedFactDiscipline,
  type PlanAssistedFactSource,
} from "@/lib/brief/custom-questions";

export const planAssistContextSchema = z
  .object({
    project_type: z.enum(BRIEF_PACK_PROJECT_TYPES),
    description: z.string().trim().max(1000).optional(),
    area_m2: z.number().positive().max(100000).nullable().optional(),
    location: z.string().trim().max(120).optional(),
    plan_notes: z.string().trim().max(1000).optional(),
    plan_files: z.array(briefPackPlanFileSchema).max(5).optional(),
  })
  .strict();

export type PlanAssistContext = z.infer<typeof planAssistContextSchema>;
export type PlanAssistedDraft = z.infer<typeof planAssistedDraftSchema>;

interface TextSource {
  source: PlanAssistedFactSource;
  text: string;
}

interface CandidateFact {
  label: string;
  value: string;
  discipline: PlanAssistedFactDiscipline;
  confidence: "low" | "medium" | "high";
  evidence: string;
  source: PlanAssistedFactSource;
  priority: number;
}

const PROJECT_TYPE_LABELS: Record<BriefPackProjectType, string> = {
  residential: "жилой проект",
  commercial: "коммерческий проект",
  wellness: "wellness / массаж",
  restaurant: "ресторан / кафе",
  office: "офис",
  retail: "ритейл",
  hospitality: "гостиничный проект",
  other: "другой тип проекта",
};

const ZONE_PATTERNS: Array<{ value: string; pattern: RegExp }> = [
  { value: "летняя кухня", pattern: /летн[а-яё]*\s+кухн|outdoor\s+kitchen/iu },
  { value: "кухня-гостиная", pattern: /кухн[а-яё]*[-\s]+гостин|kitchen[-\s]+living/iu },
  { value: "кухня", pattern: /кухн|kitchen/i },
  { value: "гостиная / столовая", pattern: /гостин|столов|living|dining/i },
  { value: "спальня", pattern: /спальн|bedroom/i },
  { value: "детская", pattern: /детск|kids?|children/i },
  { value: "санузел", pattern: /с\/у|сануз|туалет|bathroom|wc/i },
  { value: "кладовая / хранение", pattern: /кладов|хранени|storage/i },
  { value: "прихожая / входная зона", pattern: /прихож|входн[а-яё]*\s+зон|entry|entrance/iu },
  { value: "холл", pattern: /холл|hall/iu },
  { value: "кабинет / рабочее место", pattern: /кабинет|рабоч[а-яё]*\s+мест|office|workspace/iu },
  { value: "ресепшен", pattern: /ресепш|reception/i },
  { value: "процедурные кабинеты", pattern: /процедур|treatment/i },
  { value: "массажные кабинеты", pattern: /массаж|massage/i },
  { value: "душевые", pattern: /душ|shower/i },
  { value: "прачечная / бельевая", pattern: /прачеч|бельев|laundry/i },
  { value: "бар", pattern: /\bбар\b|bar/i },
  { value: "BOH / служебные зоны", pattern: /\bboh\b|служеб|back\s+of\s+house/i },
];

const SYSTEM_PATTERNS: Array<{ value: string; pattern: RegExp }> = [
  { value: "вентиляция / вытяжка", pattern: /вентиляц|вытяж|ventilation|exhaust|fresh\s+air|duct/i },
  { value: "кондиционирование", pattern: /кондицион|hvac|\bac\b|air\s+condition/i },
  { value: "вода и канализация", pattern: /водоснаб|канализац|waste\s*water|grey\s*waste|black\s*water|clean\s*water|septic|stp/i },
  { value: "электрика", pattern: /электр|розет|lighting|power|led/i },
  { value: "слаботочные системы", pattern: /cctv|интернет|wi[-\s]?fi|data|network/i },
  { value: "пожарная безопасность", pattern: /fire|пожар|extinguisher/i },
  { value: "ливневая вода / дренаж", pattern: /rain\s*water|ливнев|дренаж|gutter/i },
];

const CONSTRAINT_PATTERNS: Array<{ value: string; pattern: RegExp }> = [
  { value: "соседство и приватность", pattern: /сосед|neighbor|privacy|приват/i },
  { value: "открытая сторона участка", pattern: /нет\s+сосед|поле|open\s+side|field/i },
  { value: "дом прижат к границе участка", pattern: /задн[а-яё]*\s+стен|границ[а-яё]*\s+участ|упирает/iu },
  { value: "мокрые точки", pattern: /мокр[а-яё]*\s+точ|wet\s+point|plumbing\s+point/iu },
  { value: "несущие стены / конструкции", pattern: /несущ|bearing|structural/i },
  { value: "высоты потолков", pattern: /высот[а-яё]*\s+потол|ceiling\s+height/iu },
  { value: "ограничения арендодателя / площадки", pattern: /арендодател|управляющ|landlord|building\s+management/i },
];

function compact(value: unknown, max = 260): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().replace(/\s+/g, " ");
  return clean ? clean.slice(0, max) : undefined;
}

function normalizeNumber(value: string): string {
  return value.replace(",", ".");
}

function sourceLabel(source: PlanAssistedFactSource): string {
  switch (source) {
    case "plan_notes":
      return "Заметки к плану";
    case "file_name":
      return "Имя файла";
    case "file_text":
      return "Текст файла";
    case "metadata":
      return "Метаданные проекта";
    case "description":
    default:
      return "Описание проекта";
  }
}

function addFact(facts: CandidateFact[], fact: CandidateFact) {
  if (!fact.value.trim()) return;
  facts.push({
    ...fact,
    value: fact.value.trim().slice(0, 260),
    evidence: fact.evidence.trim().slice(0, 260),
  });
}

function textSources(context: PlanAssistContext): TextSource[] {
  const description = compact(sanitizeDesignerPrompt(context.description ?? ""), 1000);
  const planNotes = compact(sanitizeDesignerPrompt(context.plan_notes ?? ""), 1000);
  return [
    description ? { source: "description", text: description } : null,
    planNotes ? { source: "plan_notes", text: planNotes } : null,
    ...(context.plan_files ?? [])
      .map((file) => compact(file.text_excerpt, 3000))
      .filter((text): text is string => Boolean(text))
      .map((text) => ({ source: "file_text" as const, text })),
    ...(context.plan_files ?? []).map((file) => ({
      source: "file_name" as const,
      text: [file.name, file.type].filter(Boolean).join(" "),
    })),
  ].filter((item): item is TextSource => Boolean(item));
}

function countPattern(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  return Array.from(text.matchAll(re)).length;
}

function inferFromFiles(files: BriefPackPlanFile[] | undefined, facts: CandidateFact[]) {
  for (const file of files ?? []) {
    const name = compact(file.name, 180);
    if (!name) continue;
    addFact(facts, {
      label: "Загружен файл",
      value: name,
      discipline: "metadata",
      confidence: "high",
      evidence: `${sourceLabel("file_name")}: ${name}`,
      source: "file_name",
      priority: 10,
    });

    const lower = name.toLowerCase();
    const inferred: Array<{ value: string; discipline: PlanAssistedFactDiscipline }> = [];
    if (/\bmep\b|hvac|electrical|plumbing|инженер/i.test(lower)) {
      inferred.push({ value: "инженерные системы / MEP", discipline: "engineering" });
    }
    if (/signage|вывес|навигац/i.test(lower)) {
      inferred.push({ value: "signage / вывески", discipline: "signage" });
    }
    if (/secondary\s+skin|facade|фасад|оболоч/i.test(lower)) {
      inferred.push({ value: "фасад / secondary skin", discipline: "facade" });
    }
    if (/floor|план|этаж|layout/i.test(lower)) {
      inferred.push({ value: "план этажа / layout", discipline: "planning" });
    }
    for (const item of inferred) {
      addFact(facts, {
        label: "Дисциплина файла",
        value: item.value,
        discipline: item.discipline,
        confidence: "medium",
        evidence: `${sourceLabel("file_name")}: ${name}`,
        source: "file_name",
        priority: 30,
      });
    }
  }
}

function inferFromText(sources: TextSource[], facts: CandidateFact[]) {
  for (const source of sources) {
    const text = source.text;
    const areaMatch = text.match(/(\d{2,5}(?:[,.]\d{1,2})?)\s*(?:м2|м²|кв\.?\s*м|sqm|m2)(?:\b|[^\p{L}\p{N}]|$)/iu);
    if (areaMatch?.[1]) {
      addFact(facts, {
        label: "Площадь из текста",
        value: `${normalizeNumber(areaMatch[1])} м²`,
        discipline: "metadata",
        confidence: "medium",
        evidence: `${sourceLabel(source.source)}: ${areaMatch[0]}`,
        source: source.source,
        priority: 20,
      });
    }

    const siteMatch = text.match(/(\d{1,3}(?:[,.]\d{1,2})?)\s*[xх×]\s*(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:м|m)(?:\b|[^\p{L}\p{N}]|$)/iu);
    if (siteMatch?.[1] && siteMatch[2]) {
      addFact(facts, {
        label: "Габариты участка / плана",
        value: `${normalizeNumber(siteMatch[1])} x ${normalizeNumber(siteMatch[2])} м`,
        discipline: "site",
        confidence: "medium",
        evidence: `${sourceLabel(source.source)}: ${siteMatch[0]}`,
        source: source.source,
        priority: 25,
      });
    }

    if (/(?:2|двух|два)\s*-?\s*(?:этаж|уровн)|2\s*(?:floor|level)/i.test(text)) {
      addFact(facts, {
        label: "Этажность",
        value: "2 этажа / уровня",
        discipline: "planning",
        confidence: "medium",
        evidence: `${sourceLabel(source.source)}: упоминание 2 этажей`,
        source: source.source,
        priority: 35,
      });
    }

    for (const zone of ZONE_PATTERNS) {
      const count = countPattern(text, zone.pattern);
      if (count === 0) continue;
      addFact(facts, {
        label: "Зона",
        value: count > 1 ? `${zone.value} (${count} упомин.)` : zone.value,
        discipline: "planning",
        confidence: "medium",
        evidence: `${sourceLabel(source.source)}: ${zone.value}`,
        source: source.source,
        priority: 45,
      });
    }

    for (const system of SYSTEM_PATTERNS) {
      if (!system.pattern.test(text)) continue;
      addFact(facts, {
        label: "Инженерная система",
        value: system.value,
        discipline: "engineering",
        confidence: "medium",
        evidence: `${sourceLabel(source.source)}: ${system.value}`,
        source: source.source,
        priority: 50,
      });
    }

    for (const constraint of CONSTRAINT_PATTERNS) {
      if (!constraint.pattern.test(text)) continue;
      addFact(facts, {
        label: "Ограничение / контекст",
        value: constraint.value,
        discipline: "constraints",
        confidence: "medium",
        evidence: `${sourceLabel(source.source)}: ${constraint.value}`,
        source: source.source,
        priority: 40,
      });
    }
  }
}

function dedupeAndShape(facts: CandidateFact[]): PlanAssistedFact[] {
  const seen = new Set<string>();
  return facts
    .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label, "ru"))
    .filter((fact) => {
      const key = `${fact.discipline}:${fact.label}:${fact.value.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30)
    .map((fact, index) => ({
      id: optionValueFromLabel(`${fact.discipline}_${fact.label}_${fact.value}`, index).slice(0, 80),
      label: fact.label,
      value: fact.value,
      discipline: fact.discipline,
      confidence: fact.confidence,
      evidence: fact.evidence,
      source: fact.source,
      status: "proposed",
    }));
}

export function derivePlanAssistedDraft(context: PlanAssistContext): PlanAssistedDraft {
  const facts: CandidateFact[] = [];
  const projectType = context.project_type;

  addFact(facts, {
    label: "Тип проекта",
    value: PROJECT_TYPE_LABELS[projectType],
    discipline: "metadata",
    confidence: "high",
    evidence: "Поле типа проекта",
    source: "metadata",
    priority: 1,
  });

  if (context.area_m2) {
    addFact(facts, {
      label: "Площадь",
      value: `${context.area_m2} м²`,
      discipline: "metadata",
      confidence: "high",
      evidence: "Поле площади",
      source: "metadata",
      priority: 2,
    });
  }

  const location = compact(context.location, 120);
  if (location) {
    addFact(facts, {
      label: "Локация",
      value: location,
      discipline: "metadata",
      confidence: "high",
      evidence: "Поле локации",
      source: "metadata",
      priority: 3,
    });
  }

  inferFromFiles(context.plan_files, facts);
  inferFromText(textSources(context), facts);

  const shaped = dedupeAndShape(facts);
  const summary =
    shaped.length > 0
      ? `Найдено фактов для проверки: ${shaped.length}. Подтвердите только то, что действительно видно на плане или известно из задачи.`
      : "Пока не удалось выделить факты. Добавьте заметки к плану или уточните описание объекта.";

  const parsed = planAssistedDraftSchema.safeParse({ summary, facts: shaped });
  return parsed.success ? parsed.data : { summary: "Проверьте описание плана.", facts: [] };
}
