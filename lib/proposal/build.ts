import type {
  Passport,
  RiskCard,
  ProposalDefaults,
  ProposalSection,
  MoneyRange,
} from "@/lib/types";
import type { PriceResult } from "@/lib/pricing/calc";

// Proposal — сборка, не генерация. Шаблон + данные брифа + рассчитанная цена.
// Каждая секция — редактируемый текст, предзаполненный детерминированно.

const OBJECT_LABEL: Record<string, string> = {
  flat: "квартира",
  house: "дом",
  apartments: "апартаменты",
};

const PACKAGE_DELIVERABLES = {
  concept: [
    "Планировочное решение (1–2 варианта)",
    "Стилистическая концепция и подбор палитры",
    "Коллаж/мудборд ключевых помещений",
  ],
  full: [
    "Планировочное решение с расстановкой мебели",
    "Стилистическая концепция и визуализации ключевых помещений",
    "Ведомости отделки и рабочие чертежи",
    "Спецификация мебели, света и оборудования",
  ],
  full_plus_supervision: [
    "Планировочное решение с расстановкой мебели",
    "Стилистическая концепция и визуализации",
    "Полный комплект рабочих чертежей и ведомостей",
    "Спецификация мебели, света и оборудования",
    "Авторский надзор на этапе реализации",
  ],
} satisfies Record<string, string[]>;

function money(n: number): string {
  return n.toLocaleString("ru-RU");
}

function rangeText(range: MoneyRange): string {
  return `от ${money(range[0])} до ${money(range[1])} ₽`;
}

function taskText(passport: Passport): string {
  const o = passport.object;
  const objLabel = o.type ? OBJECT_LABEL[o.type] : "объект";
  const area = o.area_m2 ? `${o.area_m2} м²` : "площадь уточняется";
  const city = o.city ? `, ${o.city}` : "";
  const horizon = {
    self_long: "для себя надолго",
    sell_2_5y: "с перспективой продажи через 2–5 лет",
    rent: "под аренду",
    unknown: "",
  }[passport.asset_horizon];

  const lines = [
    `Объект: ${objLabel}, ${area}${city}.`,
    `Проживание: ${passport.household.now}${horizon ? `; горизонт — ${horizon}` : ""}.`,
  ];
  if (passport.pain_points.trim()) {
    lines.push(`Что важно решить: ${passport.pain_points.trim()}`);
  }
  return lines.join("\n");
}

function deliverables(pkg: keyof typeof PACKAGE_DELIVERABLES): string[] {
  return PACKAGE_DELIVERABLES[pkg] ?? PACKAGE_DELIVERABLES.full;
}

function worksText(pkg: keyof typeof PACKAGE_DELIVERABLES): string {
  return deliverables(pkg)
    .map((d) => `— ${d}`)
    .join("\n");
}

function stagesText(termWeeks: [number, number] | null): string {
  const term = termWeeks ? `Ориентировочный срок: ${termWeeks[0]}–${termWeeks[1]} недель.` : "";
  return [
    "1. Бриф и техническое задание — согласование исходных данных.",
    "2. Планировочное решение — варианты, выбор финального.",
    "3. Стилистическая концепция — палитра, материалы, визуализации.",
    "4. Рабочая документация — чертежи, ведомости, спецификации.",
    term,
  ]
    .filter(Boolean)
    .join("\n");
}

function includedText(pkg: keyof typeof PACKAGE_DELIVERABLES, acceptedCards: RiskCard[]): string {
  const base = deliverables(pkg).map((d) => `— ${d}`);
  const fromRisks = acceptedCards
    .filter((c) => c.proposal_implication.trim())
    .map((c) => `— С учётом обсуждённого (${c.risk_type}): ${c.proposal_implication}`);
  return [...base, ...fromRisks].join("\n");
}

function excludedText(defaults: ProposalDefaults): string {
  const items = defaults.exclusions.length
    ? defaults.exclusions
    : ["Строительно-монтажные работы", "Закупка мебели и материалов"];
  return items.map((e) => `— ${e}`).join("\n");
}

function clientInputsText(passport: Passport): string {
  const needs: string[] = ["Актуальные обмеры или план БТИ"];
  if (!passport.object.area_m2) needs.push("Точная площадь объекта");
  if (passport.style.refs.length === 0) needs.push("Референсы желаемого стиля");
  needs.push("Согласование ключевых решений по этапам");
  return needs.map((n) => `— ${n}`).join("\n");
}

export interface BuildProposalArgs {
  passport: Passport;
  acceptedCards: RiskCard[];
  defaults: ProposalDefaults;
  price: PriceResult | null; // null → режим «без цены»
  packageChoice: keyof typeof PACKAGE_DELIVERABLES;
}

export function buildProposalSections(args: BuildProposalArgs): ProposalSection[] {
  const { passport, acceptedCards, defaults, price, packageChoice } = args;

  const sections: ProposalSection[] = [
    { id: "task", title: "Задача клиента", body: taskText(passport) },
    { id: "works", title: "Состав работ", body: worksText(packageChoice) },
    { id: "stages", title: "Этапы и сроки", body: stagesText(price?.term_weeks ?? null) },
  ];

  if (price) {
    const breakdown = price.factors.map((f) => `— ${f.label}: ${f.value}`).join("\n");
    sections.push({
      id: "price",
      title: "Стоимость",
      body: `Диапазон стоимости дизайн-проекта: ${rangeText(price.range)}.\n\nКак считается:\n${breakdown}`,
    });
  }

  sections.push(
    { id: "included", title: "Что входит", body: includedText(packageChoice, acceptedCards) },
    { id: "excluded", title: "Что не входит", body: excludedText(defaults) },
    {
      id: "revisions",
      title: "Лимиты правок",
      body: `Включено кругов правок на каждом этапе: ${defaults.revision_limit || 2}.`,
    },
    { id: "client_inputs", title: "Что нужно от клиента", body: clientInputsText(passport) },
    {
      id: "stage_completion",
      title: "Условия завершения этапов",
      body:
        defaults.stage_completion ||
        "Этап считается завершённым после письменного согласования материалов этапа клиентом.",
    },
  );

  return sections;
}
