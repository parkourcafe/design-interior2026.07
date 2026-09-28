import { createHash } from "node:crypto";
import { ru } from "@/lib/i18n/ru";

// Версия текста согласия на обработку персональных данных, которое клиент
// отмечает в брифе. Документы пока в статусе проекта (на согласовании), и
// версия это говорит прямо — «draft». При изменении текста согласия или
// утверждении документов юристом версия меняется здесь, а хеш — сам.
export const INTAKE_CONSENT_VERSION = "consent-draft-2026-09-28";

/** sha256 точного текста, рядом с которым клиент ставил отметку. */
export const INTAKE_CONSENT_TEXT_SHA256 = createHash("sha256")
  .update(ru.brief.consent, "utf8")
  .digest("hex");
