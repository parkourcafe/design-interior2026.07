/**
 * Классификатор сообщений в кандидаты Project Inbox.
 *
 * ДЕТЕРМИНИРОВАННЫЙ, БЕЗ LLM — и это решение, а не заготовка. A7 §2.1
 * запрещает давать LLM tool-доступ к mutations, и самый надёжный способ этого
 * не нарушить на первом шаге — не звать модель вовсе. Модель добавится тогда,
 * когда появится, что ей показать, и её роль останется той же: предложить.
 * Схема кандидата уже различает `origin` — `rule` сегодня, `ai` завтра, и
 * человек в обоих случаях видит, откуда взялось предложение.
 *
 * ЧТО КЛАССИФИКАТОР НЕ ДЕЛАЕТ. Не исполняет текст. Слово «подтверждаю» в чате
 * не выполняет `acknowledge_release`, а порождает КАНДИДАТА, который человек
 * рассмотрит в RemHaOS. Разница не формальная: официальное действие требует
 * входа, роли и явного подтверждения (A7 §1.7).
 *
 * Правила намеренно узкие. Классификатор, который на всё отвечает
 * «предложение», превращает Inbox в свалку, и человек перестаёт его читать —
 * то есть граница «предложено ≠ утверждено» рушится не запретом, а усталостью.
 */

import { ru } from "@/lib/i18n/ru";

export const EXTRACTION_SCHEMA_VERSION = "telegram-extraction/1" as const;

export type CandidateKind =
  | "question"
  | "decision_candidate"
  | "change_request_candidate"
  | "risk_candidate"
  | "general_note";

export type CandidateConfidence = "low" | "medium" | "high";

export interface ExtractedCandidate {
  readonly kind: CandidateKind;
  readonly summary: string;
  readonly confidence: CandidateConfidence;
}

const SUMMARY_LIMIT = 2000;

/**
 * Замена: «вместо X поставим Y», «нет в наличии», «привезли не то». Это самый
 * дорогой вид сообщения на стройке и первый, ради которого строится контур
 * M3 → M4.
 */
const CHANGE_MARKERS = [
  "вместо",
  "замен",
  "нет в наличии",
  "не поставля",
  // «снят с производства» и «сняли с производства» — одна и та же новость,
  // и разная только формой глагола. Маркер поэтому по существительному.
  "с производств",
  "аналог",
  "подмен",
  "переделыва",
  "не подошл",
];

/** Риск: сказано про срок, простой или несоответствие. */
const RISK_MARKERS = [
  "не успева",
  "задерж",
  "простой",
  "срыв",
  "брак",
  "трещин",
  "протеч",
  "не соответств",
];

const QUESTION_MARKERS = ["?", "как быть", "что делать", "подскажите"];

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function summarize(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= SUMMARY_LIMIT) return collapsed;
  // Обрезка по границе слова: полуслово в карточке читается как ошибка
  // системы, а не как длинное сообщение.
  const cut = collapsed.slice(0, SUMMARY_LIMIT - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > SUMMARY_LIMIT / 2 ? cut.slice(0, lastSpace) : cut}…`;
}

function contains(haystack: string, markers: readonly string[]): boolean {
  return markers.some((marker) => haystack.includes(marker));
}

/**
 * Возвращает null, когда предлагать нечего. Пустое сообщение, стикер, «ок» —
 * это не предложение проекту, и карточка на них была бы шумом.
 */
export function classifyMessage(input: {
  readonly text: string | null | undefined;
  readonly attachmentCount: number;
}): ExtractedCandidate | null {
  const raw = typeof input.text === "string" ? input.text : "";
  const text = normalize(raw);

  if (text === "" && input.attachmentCount === 0) return null;

  if (text === "") {
    // Вложение без текста: содержимое файла здесь не читается (ни OCR, ни
    // распознавание — вне P0), поэтому честный вид — заметка.
    return {
      kind: "general_note",
      summary: ru.telegramBridge.inbox.attachmentsOnly(input.attachmentCount),
      confidence: "low",
    };
  }

  // Короткие подтверждения — самый частый вид сообщения в рабочем чате и
  // ровно тот, который НЕЛЬЗЯ принимать за официальное действие.
  if (/^(ок|окей|ok|принял|принято|да|\+|спасибо|хорошо|понял)[.!]?$/.test(text)) {
    return null;
  }

  if (contains(text, CHANGE_MARKERS)) {
    return {
      kind: "change_request_candidate",
      summary: summarize(raw),
      // `high` не ставится никогда: правило видит слово, а не намерение.
      confidence: "medium",
    };
  }
  if (contains(text, RISK_MARKERS)) {
    return { kind: "risk_candidate", summary: summarize(raw), confidence: "medium" };
  }
  if (contains(text, QUESTION_MARKERS)) {
    return { kind: "question", summary: summarize(raw), confidence: "low" };
  }

  return { kind: "general_note", summary: summarize(raw), confidence: "low" };
}
