// Правка паспорта дизайнером перед передачей исполнителю (решение владельца
// 02.10.2026, B-1). Только перечисленные поля сводки, которые видит исполнитель
// и которые могут разойтись с принятым КП. Ответы клиента не меняются: правка
// пишется в projects.passport (существующий триггер добавляет неизменяемую
// ревизию) и в журнал правок с автором.

import type { Passport } from "@/lib/types";

export type CorrectionField =
  | "object.area_m2"
  | "object.condition"
  | "object.replanning"
  | "lifestyle.bathrooms"
  | "lifestyle.cooking"
  | "timeline.target"
  | "timeline.urgency"
  | "style.notes";

interface ChoiceSpec { readonly kind: "choice"; readonly options: readonly string[] }
interface NumberSpec { readonly kind: "number"; readonly min: number; readonly max: number; readonly integer: boolean }
interface TextSpec { readonly kind: "text"; readonly max: number }
export type FieldSpec = ChoiceSpec | NumberSpec | TextSpec;

export const CORRECTION_FIELDS: Readonly<Record<CorrectionField, FieldSpec>> = {
  "object.area_m2": { kind: "number", min: 1, max: 10000, integer: false },
  "object.condition": { kind: "choice", options: ["shell", "rough", "lived"] },
  "object.replanning": { kind: "choice", options: ["no", "maybe", "yes"] },
  "lifestyle.bathrooms": { kind: "number", min: 0, max: 20, integer: true },
  "lifestyle.cooking": { kind: "choice", options: ["none", "basic", "heavy"] },
  "timeline.target": { kind: "text", max: 200 },
  "timeline.urgency": { kind: "choice", options: ["normal", "urgent"] },
  "style.notes": { kind: "text", max: 2000 },
};

export function isCorrectionField(value: unknown): value is CorrectionField {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CORRECTION_FIELDS, value);
}

/** Значение из формы → допустимое значение поля или null. */
export function parseCorrectionValue(field: CorrectionField, raw: unknown): string | number | null {
  const spec = CORRECTION_FIELDS[field];
  if (spec.kind === "choice") return typeof raw === "string" && spec.options.includes(raw) ? raw : null;
  if (spec.kind === "number") {
    const value = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
    if (!Number.isFinite(value) || value < spec.min || value > spec.max) return null;
    if (spec.integer && !Number.isInteger(value)) return null;
    return value;
  }
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\r\n/g, "\n").trim();
  return text.length <= spec.max ? text : null;
}

export function readCorrectionField(passport: Passport, field: CorrectionField): unknown {
  const [group, key] = field.split(".") as [keyof Passport, string];
  const section = passport[group] as Record<string, unknown> | undefined;
  return section ? section[key] : undefined;
}

/** Новый паспорт с одним изменённым полем; остальное — без изменений. */
export function applyCorrection(passport: Passport, field: CorrectionField, value: string | number): Passport {
  const [group, key] = field.split(".") as [keyof Passport, string];
  const section = (passport[group] ?? {}) as Record<string, unknown>;
  return { ...passport, [group]: { ...section, [key]: value } } as Passport;
}
