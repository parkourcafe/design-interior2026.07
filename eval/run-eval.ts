// Mini-eval: прогон фикстурных брифов разных профилей через rules-слой пайплайна.
// Пишет пары «бриф → карточки» в eval/phase1_results.md.
//
// LLM-слой (YandexGPT) требует реальных YC_FOLDER_ID/YC_API_KEY. Без них
// пайплайн детерминированно деградирует к rule-карточкам — их и фиксируем.
// При наличии ключей замените evaluateRules на полный runRiskPipeline.

import { writeFileSync } from "node:fs";
import { buildPassport } from "../lib/brief/passport";
import { evaluateRules } from "../lib/risks/rules";
import type { RiskCard } from "../lib/types";

interface Fixture {
  name: string;
  answers: Record<string, unknown>;
}

const fixtures: Fixture[] = [
  {
    name: "Бюджетный конфликт (эконом + натуральный камень)",
    answers: {
      object: { type: "flat", area_m2: 55, city: "Уфа" },
      asset_horizon: "self_long",
      household: ["alone_or_couple"],
      morning: "mid_1bath",
      cooking: "basic",
      storage: ["clothes"],
      budget: { range: [500_000, 900_000] },
      timeline: "6_12m",
      style: { refs: [], anti: [], notes: "хочу натуральный камень, мрамор на кухне, дорого-богато" },
      pain: "тесная кухня",
    },
  },
  {
    name: "Срочность + индивидуальная мебель",
    answers: {
      object: { type: "flat", area_m2: 70, city: "Москва" },
      asset_horizon: "self_long",
      household: ["kids_now"],
      morning: "mid_2bath",
      cooking: "heavy",
      cooking_people: 4,
      storage: ["clothes", "tech"],
      budget: { range: [3_000_000, 5_000_000] },
      timeline: "urgent",
      style: { refs: [], anti: [], notes: "вся мебель на заказ, кухня и шкафы — столярка под нас" },
      pain: "нет места для хранения",
    },
  },
  {
    name: "Минимализм + высокое хранение",
    answers: {
      object: { type: "flat", area_m2: 45, city: "Самара" },
      asset_horizon: "self_long",
      household: ["alone_or_couple"],
      morning: "low_1bath",
      cooking: "basic",
      storage: ["clothes", "sport", "books", "tech"],
      budget: { range: [1_500_000, 2_500_000] },
      timeline: "flex",
      style: { refs: [], anti: ["глянец"], notes: "строгий минимализм, ничего лишнего на виду" },
      pain: "визуальный беспорядок",
    },
  },
  {
    name: "Продажа через 2–5 лет + кастомизация",
    answers: {
      object: { type: "flat", area_m2: 60, city: "Тюмень" },
      asset_horizon: "sell_2_5y",
      household: ["alone_or_couple"],
      morning: "mid_1bath",
      cooking: "basic",
      storage: ["clothes"],
      budget: { range: [2_000_000, 3_000_000] },
      timeline: "6_12m",
      style: { refs: [], anti: [], notes: "хочу всё индивидуально, встроенные шкафы, уникальные решения" },
      pain: "хочу подороже смотрелось",
    },
  },
  {
    name: "Высокая утренняя нагрузка + один санузел",
    answers: {
      object: { type: "flat", area_m2: 65, city: "Пермь" },
      asset_horizon: "self_long",
      household: ["kids_now", "parents"],
      morning: "high_1bath",
      cooking: "heavy",
      cooking_people: 5,
      storage: ["clothes", "sport"],
      budget: { range: [2_500_000, 4_000_000] },
      timeline: "6_12m",
      style: { refs: ["https://ref"], anti: [], notes: "тёплый скандинавский стиль" },
      pain: "утром очередь в ванную",
    },
  },
  {
    name: "Полностью бесконфликтный",
    answers: {
      object: { type: "flat", area_m2: 80, city: "Москва" },
      asset_horizon: "self_long",
      household: ["alone_or_couple"],
      morning: "low_1bath",
      cooking: "basic",
      storage: ["all_fits"],
      budget: { range: [4_000_000, 6_000_000] },
      timeline: "flex",
      style: { refs: ["https://ref"], anti: [], notes: "спокойный современный стиль, светлая палитра" },
      pain: "хочется больше воздуха",
    },
  },
  {
    name: "Аренда + дорогая отделка",
    answers: {
      object: { type: "flat", area_m2: 40, city: "Казань" },
      asset_horizon: "rent",
      household: ["alone_or_couple"],
      morning: "low_1bath",
      cooking: "none",
      storage: ["all_fits"],
      budget: { range: [800_000, 1_200_000] },
      timeline: "urgent",
      style: { refs: [], anti: [], notes: "натуральный массив дерева, премиальные материалы, мебель на заказ" },
      pain: "нужно быстро сдать",
    },
  },
  {
    name: "Семья с детьми, средний бюджет, срочно",
    answers: {
      object: { type: "house", area_m2: 120, city: "Краснодар" },
      asset_horizon: "self_long",
      household: ["kids_now", "kids_future", "pets"],
      morning: "high_1bath",
      cooking: "heavy",
      cooking_people: 4,
      storage: ["clothes", "sport", "tech", "books"],
      budget: { range: [3_000_000, 4_500_000] },
      timeline: "urgent",
      style: { refs: [], anti: [], notes: "уютный минимализм, мебель на заказ под детей" },
      pain: "всё разбросано, негде хранить",
    },
  },
  {
    name: "Премиум-бюджет, сложный стиль (без конфликтов бюджета)",
    answers: {
      object: { type: "apartments", area_m2: 140, city: "Москва" },
      asset_horizon: "self_long",
      household: ["alone_or_couple"],
      morning: "mid_2bath",
      cooking: "heavy",
      cooking_people: 2,
      storage: ["clothes"],
      budget: { range: [12_000_000, 18_000_000] },
      timeline: "flex",
      style: { refs: ["https://ref"], anti: [], notes: "натуральный камень, массив, латунь — премиальная классика" },
      pain: "хочу статусный интерьер",
    },
  },
];

function fmtCard(c: RiskCard): string {
  return [
    `- **[${c.risk_type}] · confidence: ${c.confidence} · source: ${c.source}**`,
    `  - Impact: ${c.impact}`,
    `  - Evidence: ${c.evidence.join("; ")}`,
    `  - Действие дизайнера: ${c.designer_action}`,
    `  - Следствие для КП: ${c.proposal_implication}`,
  ].join("\n");
}

const lines: string[] = [
  "# Phase 1 — mini-eval: бриф → карточки рисков",
  "",
  "Прогон 9 фикстурных брифов разных профилей через **rules-слой** пайплайна",
  "(`buildPassport` → `evaluateRules`).",
  "",
  "> ⚠️ LLM-слой (YandexGPT) в этом прогоне не участвовал: в среде разработки нет",
  "> реальных `YC_FOLDER_ID` / `YC_API_KEY`. Пайплайн `runRiskPipeline` детерминированно",
  "> деградирует к rule-карточкам (обязательная деградация из CLAUDE.md). С реальными",
  "> ключами LLM-проход добавит семантические конфликты (стиль/функция) поверх",
  "> детерминированных — качество этих карточек оценивается руками на реальном провайдере",
  "> перед командой «продолжай».",
  "",
];

for (const f of fixtures) {
  const passport = buildPassport(f.answers);
  const cards = evaluateRules(passport, f.answers);
  lines.push(`## ${f.name}`);
  lines.push("");
  lines.push("**Паспорт (ключевое):**");
  lines.push(
    "```",
    `object: ${passport.object.type ?? "—"}, ${passport.object.area_m2 ?? "—"} м², ${passport.object.city ?? "—"}`,
    `asset_horizon: ${passport.asset_horizon}`,
    `budget: ${passport.budget.range === "undisclosed" ? "не назван" : passport.budget.range.join("–")} (tier: ${passport.budget.risk_level})`,
    `lifestyle: morning=${passport.lifestyle.morning_load}, bathrooms=${passport.lifestyle.bathrooms ?? "—"}, cooking=${passport.lifestyle.cooking}, storage=${passport.lifestyle.storage_pressure}`,
    `timeline: ${passport.timeline.target} (${passport.timeline.urgency})`,
    "```",
  );
  lines.push("");
  lines.push(`**Карточки рисков (${cards.length}):**`);
  lines.push("");
  if (cards.length === 0) {
    lines.push("_Детерминированных конфликтов не найдено. (LLM-слой мог бы добавить мягкие семантические риски.)_");
  } else {
    for (const c of cards) lines.push(fmtCard(c));
  }
  lines.push("");
}

writeFileSync("eval/phase1_results.md", lines.join("\n"));
console.log("eval/phase1_results.md written:", fixtures.length, "fixtures");
