import type { Passport, RiskCard, ScopePackage } from "@/lib/types";

type RecommendedPackage = Exclude<ScopePackage, null>;

export interface PackageRecommendation {
  package: RecommendedPackage;
  reasons: string[];
}

function hasAcceptedRisk(cards: RiskCard[], types: RiskCard["risk_type"][]): boolean {
  return cards.some((c) => types.includes(c.risk_type));
}

// Детерминированная рекомендация пакета для M1. Это не pricing-мастер и не ML:
// только объяснимые правила из паспорта и уже принятых дизайнером рисков.
export function recommendPackage(
  passport: Passport,
  acceptedCards: RiskCard[] = [],
): PackageRecommendation {
  const technicalOrTimelineRisk = hasAcceptedRisk(acceptedCards, ["technical", "timeline"]);
  const manyZones = (passport.rooms?.zones?.length ?? 0) >= 4;
  const implementationSensitive =
    passport.object.replanning === "yes" ||
    passport.rooms?.balcony === "attach" ||
    passport.timeline.urgency === "urgent" ||
    technicalOrTimelineRisk ||
    manyZones;

  if (implementationSensitive) {
    const reasons: string[] = [];
    if (passport.object.replanning === "yes") reasons.push("планируется перепланировка");
    if (passport.rooms?.balcony === "attach") reasons.push("есть технически чувствительное решение по балкону");
    if (passport.timeline.urgency === "urgent") reasons.push("клиент ожидает сжатые сроки");
    if (technicalOrTimelineRisk) reasons.push("приняты риски по срокам или технической части");
    if (manyZones) reasons.push("запрошено много функциональных зон");
    return { package: "full_plus_supervision", reasons };
  }

  const resaleOrRent = passport.asset_horizon === "sell_2_5y" || passport.asset_horizon === "rent";
  const budgetIsTight =
    passport.budget.range !== "undisclosed" &&
    (passport.budget.risk_level === "low" || passport.budget.risk_level === "mid");

  if (resaleOrRent && budgetIsTight) {
    return {
      package: "concept",
      reasons: [
        passport.asset_horizon === "rent"
          ? "объект планируют сдавать в аренду"
          : "объект могут продать через 2-5 лет",
        "бюджетный уровень не предполагает глубокую кастомизацию",
      ],
    };
  }

  const reasons = ["нужен полный состав решений для согласованного КП"];
  if (passport.asset_horizon === "self_long") reasons.push("жилье планируется для себя надолго");
  if (passport.style.refs.length > 0 || passport.style.directions?.length) {
    reasons.push("есть стилевые ориентиры для проработки проекта");
  }
  return { package: "full", reasons };
}
