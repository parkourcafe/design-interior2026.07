import type { PricingConfig, MoneyRange, ScopePackage } from "@/lib/types";

// Цена v0.1 — детерминированный расчёт, rules-based, без ML.
// Диапазон = base × area × произведение выбранных множителей, с прозрачной
// разбивкой («почему цена такая»). Деньги — integer в рублях.

export type ComplexityLevel = "low" | "mid" | "high";

export interface PriceInputs {
  area_m2: number;
  complexity: ComplexityLevel;
  urgent: boolean;
  // package из паспорта; null → трактуем как 'full' для расчёта.
  package: Exclude<ScopePackage, null>;
}

export interface PriceFactor {
  label: string;
  value: string;
}

export interface PriceResult {
  range: MoneyRange; // [min, max] в рублях
  term_weeks: [number, number];
  factors: PriceFactor[];
}

// Ширина диапазона вокруг точечной оценки (неопределённость до первой встречи).
const BAND = 0.1;

function roundTo(value: number, step = 1000): number {
  return Math.round(value / step) * step;
}

function baseTermWeeks(pkg: PriceInputs["package"]): number {
  switch (pkg) {
    case "concept":
      return 4;
    case "full":
      return 8;
    case "full_plus_supervision":
      return 12;
  }
}

export function calcPrice(pricing: PricingConfig, inputs: PriceInputs): PriceResult {
  const { area_m2, complexity, urgent, package: pkg } = inputs;

  const complexityMul = pricing.multipliers.complexity[complexity];
  const urgencyMul = urgent ? pricing.multipliers.urgency : 1;
  const packageMul = pricing.multipliers.package[pkg];

  const point = pricing.base_rate_per_m2 * area_m2 * complexityMul * urgencyMul * packageMul;

  const range: MoneyRange = [roundTo(point * (1 - BAND)), roundTo(point * (1 + BAND))];

  const baseWeeks = baseTermWeeks(pkg);
  const areaWeeks = Math.round(area_m2 / 40);
  const minWeeks = Math.max(2, baseWeeks + areaWeeks - (urgent ? 2 : 0));
  const maxWeeks = minWeeks + 4;

  const complexityLabel = { low: "низкая", mid: "средняя", high: "высокая" }[complexity];
  const packageLabel = {
    concept: "концепция",
    full: "полный проект",
    full_plus_supervision: "полный проект + авторский надзор",
  }[pkg];

  const factors: PriceFactor[] = [
    { label: "Базовая ставка", value: `${pricing.base_rate_per_m2} ₽/м²` },
    { label: "Площадь", value: `${area_m2} м²` },
    { label: "Сложность стиля", value: `${complexityLabel} (×${complexityMul})` },
    { label: "Пакет услуг", value: `${packageLabel} (×${packageMul})` },
  ];
  if (urgent) {
    factors.push({ label: "Срочность", value: `×${pricing.multipliers.urgency}` });
  }

  return { range, term_weeks: [minWeeks, maxWeeks], factors };
}
