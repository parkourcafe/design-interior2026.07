import type {
  Passport,
  AssetHorizon,
  ObjectType,
  Load,
  Cooking,
  MoneyRange,
} from "@/lib/types";

// buildPassport(answers) — детерминированное отображение сырых ответов в
// машиночитаемый shadow-паспорт. Никаких сетевых вызовов, никакого LLM.
// Обязательно покрыт unit-тестами (см. passport.test.ts).

type Answers = Record<string, unknown>;

// ── typed getters ────────────────────────────────────────
function str(a: Answers, id: string): string | undefined {
  const v = a[id];
  return typeof v === "string" ? v : undefined;
}
function arr(a: Answers, id: string): string[] {
  const v = a[id];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function obj(a: Answers, id: string): Record<string, unknown> {
  const v = a[id];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// ── budget tier (₽/м² total ремонт+комплектация) ─────────
// budget.risk_level кодирует бюджетный УРОВЕНЬ: low = эконом/тесный,
// mid = средний, high = премиальный. Правила читают именно его.
const BUDGET_LOW_MAX = 20000;
const BUDGET_MID_MAX = 50000;

function budgetTier(range: MoneyRange | "undisclosed", area: number | null): Load {
  if (range === "undisclosed" || !area || area <= 0) return "mid";
  const perM2 = range[1] / area;
  if (perM2 < BUDGET_LOW_MAX) return "low";
  if (perM2 <= BUDGET_MID_MAX) return "mid";
  return "high";
}

// ── морфология ответов ───────────────────────────────────
function morningLoad(v: string | undefined): { load: Load; bathrooms: number | null } {
  switch (v) {
    case "low_1bath":
      return { load: "low", bathrooms: 1 };
    case "mid_1bath":
      return { load: "mid", bathrooms: 1 };
    case "high_1bath":
      return { load: "high", bathrooms: 1 };
    case "mid_2bath":
      return { load: "mid", bathrooms: 2 };
    default:
      return { load: "low", bathrooms: null };
  }
}

function storagePressure(selected: string[]): Load {
  const real = selected.filter((s) => s !== "all_fits");
  if (real.length === 0) return "low";
  if (real.length >= 3) return "high";
  return "mid";
}

function timeline(v: string | undefined): { target: string; urgency: "normal" | "urgent" } {
  switch (v) {
    case "urgent":
      return { target: "до 3–4 месяцев", urgency: "urgent" };
    case "6_12m":
      return { target: "6–12 месяцев", urgency: "normal" };
    case "flex":
    default:
      return { target: "гибкие сроки", urgency: "normal" };
  }
}

function householdText(selected: string[]): { now: string; in_5y: string; kids: boolean; pets: boolean } {
  const kids = selected.includes("kids_now") || selected.includes("kids_future");
  const pets = selected.includes("pets");

  const nowParts: string[] = [];
  if (selected.includes("alone_or_couple")) nowParts.push("1–2 человека");
  if (selected.includes("kids_now")) nowParts.push("с детьми");
  if (selected.includes("parents")) nowParts.push("родители рядом");
  if (pets) nowParts.push("с животными");

  const futureParts: string[] = [...nowParts.filter((p) => p !== "с детьми")];
  if (selected.includes("kids_now") || selected.includes("kids_future")) {
    futureParts.push("дети");
  }
  if (selected.includes("parents")) futureParts.push("родители");

  return {
    now: nowParts.join(", ") || "не указано",
    in_5y: futureParts.join(", ") || "не указано",
    kids,
    pets,
  };
}

function normalizeBudgetRange(raw: unknown): MoneyRange | "undisclosed" {
  if (raw === "undisclosed") return "undisclosed";
  if (Array.isArray(raw) && raw.length === 2 && raw.every((n) => typeof n === "number")) {
    return [raw[0] as number, raw[1] as number];
  }
  return "undisclosed";
}

export function buildPassport(answers: Answers): Passport {
  const objectAns = obj(answers, "object");
  const area =
    typeof objectAns.area_m2 === "number" && objectAns.area_m2 > 0 ? objectAns.area_m2 : null;
  const objectType = ((): ObjectType | null => {
    const t = objectAns.type;
    return t === "flat" || t === "house" || t === "apartments" ? t : null;
  })();
  const city = typeof objectAns.city === "string" && objectAns.city.trim() ? objectAns.city.trim() : null;

  const assetHorizon = ((): AssetHorizon => {
    const v = str(answers, "asset_horizon");
    return v === "self_long" || v === "sell_2_5y" || v === "rent" ? v : "unknown";
  })();

  const morning = morningLoad(str(answers, "morning"));

  const cooking = ((): Cooking => {
    const v = str(answers, "cooking");
    return v === "none" || v === "basic" || v === "heavy" ? v : "none";
  })();

  // budget-ответ хранится как { range: [min,max] } либо { range: "undisclosed" }.
  const range: MoneyRange | "undisclosed" = normalizeBudgetRange(obj(answers, "budget").range);

  const styleAns = obj(answers, "style");
  const cleanStrings = (v: unknown): string[] =>
    Array.isArray(v)
      ? (v as unknown[]).filter((x): x is string => typeof x === "string" && x.trim() !== "")
      : [];
  const style = {
    refs: cleanStrings(styleAns.refs),
    anti: cleanStrings(styleAns.anti),
    notes: typeof styleAns.notes === "string" ? styleAns.notes : "",
  };

  return {
    object: { type: objectType, area_m2: area, city },
    asset_horizon: assetHorizon,
    household: householdText(arr(answers, "household")),
    lifestyle: {
      morning_load: morning.load,
      bathrooms: morning.bathrooms,
      cooking,
      storage_pressure: storagePressure(arr(answers, "storage")),
    },
    budget: {
      range,
      risk_level: budgetTier(range, area),
    },
    timeline: timeline(str(answers, "timeline")),
    style,
    pain_points: str(answers, "pain") ?? "",
    scope: { package: null },
  };
}
