import type { Passport, RiskCard, RiskStatus } from "@/lib/types";

// Обогащённая карточка, как она приходит из таблицы risk_cards (с id и статусом).
export interface RiskCardRow extends RiskCard {
  id: string;
  status: RiskStatus;
}

// Недостающие данные — пустые поля паспорта (для блока «недостающие данные»).
export function missingFields(passport: Passport): string[] {
  const missing: string[] = [];
  if (!passport.object.type) missing.push("Тип объекта");
  if (!passport.object.area_m2) missing.push("Площадь");
  if (!passport.object.city) missing.push("Город");
  if (passport.asset_horizon === "unknown") missing.push("Горизонт актива (планы на жильё)");
  if (passport.budget.range === "undisclosed") missing.push("Бюджетный коридор");
  if (passport.style.refs.length === 0) missing.push("Референсы стиля");
  if (!passport.pain_points.trim()) missing.push("Что раздражает в текущем жилье");
  return missing;
}

// Вопросы к первой встрече — из designer_action ПРИНЯТЫХ карточек.
export function firstMeetingQuestions(cards: Array<Pick<RiskCardRow, "designer_action" | "status">>): string[] {
  return cards
    .filter((c) => c.status === "accepted")
    .map((c) => c.designer_action)
    .filter((q) => q.trim().length > 0);
}
