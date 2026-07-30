import type { Confidence, Passport, RiskCard, RiskStatus, ScopePackage } from "@/lib/types";
import type { PriceFactor } from "@/lib/pricing/calc";

export type PackageKey = Exclude<ScopePackage, null>;

export type PackageReasonCode =
  | "insufficient_data"
  | "simple_project"
  | "asset_for_rent_or_resale"
  | "tight_budget"
  | "standard_full_project"
  | "multiple_zones"
  | "working_docs_needed"
  | "furniture_or_equipment_scope"
  | "implementation_sensitive"
  | "urgent_timeline"
  | "technical_or_timeline_risk"
  | "unclear_budget"
  | "custom_or_complex_scope";

export interface PackageRiskCard extends RiskCard {
  status?: RiskStatus;
}

export interface PackageRecommendation {
  package_key: PackageKey;
  package_label: string;
  confidence: Confidence;
  reason_codes: PackageReasonCode[];
  included_service_items: string[];
  pricing_explanation_points: string[];
  client_facing_explanation: string;
  internal_notes?: string[];
}

export interface LegacyPackageRecommendation {
  package: PackageKey;
  reasons: string[];
}

export interface DerivePackageRecommendationArgs {
  passport: Passport;
  answers?: Record<string, unknown>;
  riskCards?: PackageRiskCard[];
  pricingFactors?: PriceFactor[];
}

const PACKAGE_LABEL: Record<PackageKey, string> = {
  concept: "Концепция",
  full: "Полный дизайн-проект",
  full_plus_supervision: "Полный дизайн-проект + сопровождение",
};

const SERVICE_ITEMS: Record<PackageKey, string[]> = {
  concept: [
    "Планировочное решение (1-2 варианта)",
    "Стилистическая концепция и палитра",
    "Мудборд ключевых помещений",
    "Список решений, которые нужно уточнить перед полным проектом",
  ],
  full: [
    "Планировочное решение с расстановкой мебели",
    "Стилистическая концепция и визуализации ключевых помещений",
    "Комплект рабочих чертежей",
    "Ведомости отделки и спецификация мебели, света и оборудования",
  ],
  full_plus_supervision: [
    "Планировочное решение с расстановкой мебели",
    "Стилистическая концепция и визуализации",
    "Полный комплект рабочих чертежей и ведомостей",
    "Спецификация мебели, света и оборудования",
    "Авторский надзор и сопровождение решений на этапе реализации",
  ],
};

function acceptedRiskCards(cards: PackageRiskCard[] = []): PackageRiskCard[] {
  return cards.filter((c) => c.status === undefined || c.status === "accepted");
}

function hasRisk(cards: PackageRiskCard[], types: RiskCard["risk_type"][]): boolean {
  return cards.some((c) => types.includes(c.risk_type));
}

function answerCorpus(answers: Record<string, unknown> | undefined, passport: Passport): string {
  return JSON.stringify({
    answers: answers ?? {},
    vision: passport.vision ?? "",
    pain_points: passport.pain_points,
    style: passport.style,
    rooms: passport.rooms ?? {},
  }).toLowerCase();
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function knownDataScore(passport: Passport): number {
  let score = 0;
  if (passport.object.type) score += 1;
  if (passport.object.area_m2) score += 1;
  if (passport.asset_horizon !== "unknown") score += 1;
  if (passport.budget.range !== "undisclosed") score += 1;
  if (passport.style.refs.length > 0 || passport.style.notes || passport.style.directions?.length) score += 1;
  if (passport.rooms || passport.lifestyle.storage_pressure !== "low" || passport.lifestyle.cooking !== "none") {
    score += 1;
  }
  return score;
}

function pushUnique<T>(items: T[], item: T): void {
  if (!items.includes(item)) items.push(item);
}

function explanationFor(pkg: PackageKey, reasonCodes: PackageReasonCode[]): string {
  if (pkg === "concept") {
    if (reasonCodes.includes("insufficient_data")) {
      return "Сейчас данных недостаточно для точного полного состава работ, поэтому безопаснее начать с концепции и уточнить рамки проекта перед расширением.";
    }
    return "Для этого запроса разумно начать с концепции: зафиксировать планировку, стиль и ограничения без преждевременного расширения состава работ.";
  }
  if (pkg === "full_plus_supervision") {
    return "Проект содержит факторы, которые влияют не только на концепцию, но и на реализацию: сроки, технические решения, комплектацию или принятые риски. Поэтому рекомендован полный проект с сопровождением решений.";
  }
  return "Запрос выглядит как стандартный дизайн-проект: нужны планировочные, стилевые и рабочие решения, достаточные для понятного КП и дальнейшей реализации.";
}

// Детерминированная рекомендация пакета для M1. Это не pricing-мастер и не ML:
// только объяснимые правила из паспорта, ответов и уже принятых дизайнером рисков.
export function derivePackageRecommendation(args: DerivePackageRecommendationArgs): PackageRecommendation {
  const { passport, answers, pricingFactors = [] } = args;
  const risks = acceptedRiskCards(args.riskCards);
  const reasonCodes: PackageReasonCode[] = [];
  const pricingPoints: string[] = [];
  const internalNotes: string[] = [];
  const text = answerCorpus(answers, passport);

  const dataScore = knownDataScore(passport);
  const insufficientData = dataScore <= 2;
  if (insufficientData) {
    pushUnique(reasonCodes, "insufficient_data");
    pricingPoints.push("Данных пока мало: пакет и цена должны быть подтверждены после уточнения вводных.");
  }

  const resaleOrRent = passport.asset_horizon === "sell_2_5y" || passport.asset_horizon === "rent";
  const budgetIsTight =
    passport.budget.range !== "undisclosed" &&
    (passport.budget.risk_level === "low" || passport.budget.risk_level === "mid");
  const simpleObject =
    (passport.object.area_m2 === null || passport.object.area_m2 <= 45) &&
    !passport.object.replanning &&
    (passport.rooms?.zones?.length ?? 0) <= 1;

  if (simpleObject) pushUnique(reasonCodes, "simple_project");
  if (resaleOrRent) pushUnique(reasonCodes, "asset_for_rent_or_resale");
  if (budgetIsTight) pushUnique(reasonCodes, "tight_budget");

  const manyZones = (passport.rooms?.zones?.length ?? 0) >= 3;
  const needsWorkingDocs =
    Boolean(passport.rooms) ||
    passport.object.replanning === "yes" ||
    passport.lifestyle.storage_pressure === "high" ||
    passport.lifestyle.cooking === "heavy";
  const furnitureOrEquipmentScope =
    passport.budget.includes_furniture === "yes" ||
    passport.lifestyle.furniture_keep === "all_new" ||
    hasAny(text, ["комплектац", "закуп", "мебел", "техника", "свет", "поставк"]);
  const remoteOrNeedsSupervision = hasAny(text, ["удален", "дистанц", "другом городе", "не смогу быть", "сопровожд"]);
  const technicalOrTimelineRisk = hasRisk(risks, ["technical", "timeline"]);
  const customScope = hasAny(text, ["индивидуальн", "на заказ", "столяр", "кастом", "встроенн"]);

  if (manyZones) pushUnique(reasonCodes, "multiple_zones");
  if (needsWorkingDocs) pushUnique(reasonCodes, "working_docs_needed");
  if (furnitureOrEquipmentScope) pushUnique(reasonCodes, "furniture_or_equipment_scope");
  if (passport.timeline.urgency === "urgent") pushUnique(reasonCodes, "urgent_timeline");
  if (technicalOrTimelineRisk) pushUnique(reasonCodes, "technical_or_timeline_risk");
  if (passport.budget.range === "undisclosed") pushUnique(reasonCodes, "unclear_budget");
  if (customScope) pushUnique(reasonCodes, "custom_or_complex_scope");

  const implementationSensitive =
    passport.object.replanning === "yes" ||
    passport.rooms?.balcony === "attach" ||
    passport.timeline.urgency === "urgent" ||
    technicalOrTimelineRisk ||
    furnitureOrEquipmentScope ||
    remoteOrNeedsSupervision;

  if (implementationSensitive) pushUnique(reasonCodes, "implementation_sensitive");

  let packageKey: PackageKey;
  if (implementationSensitive) {
    packageKey = "full_plus_supervision";
  } else if (insufficientData || (simpleObject && (resaleOrRent || budgetIsTight))) {
    packageKey = "concept";
  } else {
    packageKey = "full";
    pushUnique(reasonCodes, "standard_full_project");
  }

  if (packageKey === "concept") {
    pricingPoints.push("Стоимость считается от базового пакета: меньше глубина проработки и меньше неопределённость до первой встречи.");
  }
  if (packageKey === "full") {
    pricingPoints.push("Стоимость включает полный пакет проектных решений: планировка, стиль, рабочая документация и спецификации.");
  }
  if (packageKey === "full_plus_supervision") {
    pricingPoints.push("К стоимости применяется пакет с сопровождением, потому что проект чувствителен к реализации, срокам или комплектации.");
  }
  if (reasonCodes.includes("urgent_timeline")) {
    pricingPoints.push("Сжатые сроки требуют отдельного подтверждения календаря и могут влиять на множитель срочности.");
  }
  if (reasonCodes.includes("unclear_budget")) {
    pricingPoints.push("Бюджет не раскрыт: ценовой диапазон остаётся предварительным до уточнения рамок.");
  }
  for (const factor of pricingFactors) {
    pricingPoints.push(`${factor.label}: ${factor.value}`);
  }

  if (risks.length === 0 && args.riskCards?.some((c) => c.status === "rejected")) {
    internalNotes.push("Отклонённые risk cards не использованы в публичной рекомендации пакета.");
  }

  return {
    package_key: packageKey,
    package_label: PACKAGE_LABEL[packageKey],
    confidence: insufficientData ? "low" : reasonCodes.length >= 3 ? "high" : "medium",
    reason_codes: reasonCodes,
    included_service_items: SERVICE_ITEMS[packageKey],
    pricing_explanation_points: pricingPoints,
    client_facing_explanation: explanationFor(packageKey, reasonCodes),
    internal_notes: internalNotes.length > 0 ? internalNotes : undefined,
  };
}

// Backward-compatible wrapper for older call sites/tests.
export function recommendPackage(
  passport: Passport,
  acceptedCards: RiskCard[] = [],
): LegacyPackageRecommendation {
  const recommendation = derivePackageRecommendation({ passport, riskCards: acceptedCards });
  return {
    package: recommendation.package_key,
    reasons: recommendation.pricing_explanation_points,
  };
}

export function deriveInitialScopePackage(passport: Passport, answers?: Record<string, unknown>): PackageKey {
  return derivePackageRecommendation({ passport, answers }).package_key;
}
