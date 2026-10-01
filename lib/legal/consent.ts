import { createHash } from "node:crypto";
import { ru } from "@/lib/i18n/ru";
import type { DesignerPublic } from "@/lib/designer";

// Согласие клиента в брифе (оценка ПДн 01.10.2026): называет студию, которой
// клиент даёт согласие, и сервис RemHaOS, которому студия поручает обработку;
// для самостоятельного брифа без дизайнера оператор — сам сервис. Текст
// собирает сервер — и для страницы брифа, и при записи согласия, — поэтому
// клиент не может подменить то, под чем «подписался». Версия «draft»: тексты
// остаются проектом до утверждения юристом; при изменении шаблона версия
// меняется здесь.
export const INTAKE_CONSENT_VERSION = "consent-draft-2026-10-01";

/** Как студия названа в согласии — так же, как в карточке «Бриф от дизайнера». */
export function consentStudioLabel(designer: DesignerPublic | null): string | null {
  if (!designer) return null;
  const name = designer.name.trim();
  const studio = designer.studio_name.trim();
  if (studio && name) return `${studio} (${name})`;
  return studio || name || designer.email.trim() || null;
}

/** Юридическое имя поставщика сервиса, если владелец его задал. */
export function consentOperatorLabel(value = process.env.NEXT_PUBLIC_LEGAL_OPERATOR_NAME): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function intakeConsentText(studio: string | null, operator: string | null): string {
  return studio ? ru.brief.consentForStudio(studio, operator) : ru.brief.consentSelfServe(operator);
}

/** sha256 точного текста, рядом с которым клиент ставил отметку. */
export function consentTextSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
