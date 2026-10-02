// Подсветка строк, которые похожи на контакты, суммы или бюджет, в тексте для
// исполнителя (решение владельца 02.10.2026, B-2). Это подсказка по шаблонам,
// а не очистка: ничего не удаляется автоматически, и отсутствие подсветки не
// гарантирует отсутствия данных. Решение по каждой строке принимает дизайнер:
// удалить её или явно оставить.

import { createHash } from "node:crypto";
import type { Passport, ProposalSection } from "@/lib/types";

export type SensitiveReason = "phone" | "email" | "money" | "budget";

export interface SensitiveFlag {
  /** Устойчивый id: где + текст строки. Отметка «оставить» привязана к нему. */
  readonly id: string;
  readonly where: string;
  readonly line: string;
  readonly reasons: readonly SensitiveReason[];
}

// Телефон: 10+ цифр с разделителями, в том числе +7 (900) 000-00-00.
const PHONE = /(?:\+?\d[\s\-().]*){10,}/u;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u;
// Число со знаком валюты или множителем: «4 500 000 ₽», «4,5 млн», «300 тыс.», «5k», «$5».
const MONEY = /(?:\d[\d\s .,]*\s?(?:₽|руб|р\.|тыс|млн|млрд|т\.\s?р\.|[kK]\b)|[₽$€]\s?\d)/u;
// \b не работает для кириллицы — граница слова задана явно.
const BUDGET = /бюджет|стоимост|гонорар|оплат|(?<![а-яё])(?:цен[аеуыо]й?|смет[аеуы]?)(?![а-яё])/iu;

export function sensitiveReasons(line: string): SensitiveReason[] {
  const reasons: SensitiveReason[] = [];
  if (PHONE.test(line)) reasons.push("phone");
  if (EMAIL.test(line)) reasons.push("email");
  if (MONEY.test(line)) reasons.push("money");
  if (BUDGET.test(line)) reasons.push("budget");
  return reasons;
}

function flagId(where: string, line: string): string {
  return createHash("sha256").update(`${where}\n${line}`).digest("hex").slice(0, 16);
}

function scan(where: string, text: string): SensitiveFlag[] {
  const flags: SensitiveFlag[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const reasons = sensitiveReasons(line);
    if (reasons.length) flags.push({ id: flagId(where, line), where, line, reasons });
  }
  return flags;
}

/** Все строковые значения сводки паспорта с путём — то, что увидит исполнитель. */
function passportStrings(value: unknown, path: string, out: [string, string][]): void {
  if (typeof value === "string") {
    if (value.trim()) out.push([path, value]);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => passportStrings(item, `${path}[${index}]`, out));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      passportStrings(item, path ? `${path}.${key}` : key, out);
    }
  }
}

/** Подсветка по тексту КП для исполнителя и по сводке паспорта. */
export function findSensitive(sections: readonly ProposalSection[], summary: Passport | null): SensitiveFlag[] {
  const flags: SensitiveFlag[] = [];
  for (const section of sections) {
    flags.push(...scan(`section:${section.id}`, `${section.title}\n${section.body}`));
  }
  if (summary) {
    const strings: [string, string][] = [];
    passportStrings(summary, "", strings);
    for (const [path, text] of strings) flags.push(...scan(`passport:${path}`, text));
  }
  const seen = new Set<string>();
  return flags.filter((flag) => (seen.has(flag.id) ? false : (seen.add(flag.id), true)));
}

/** Подсветки без решения дизайнера («оставить»). Каждая блокирует подтверждение. */
export function unresolvedFlags(flags: readonly SensitiveFlag[], acknowledged: readonly string[]): SensitiveFlag[] {
  const ack = new Set(acknowledged);
  return flags.filter((flag) => !ack.has(flag.id));
}
