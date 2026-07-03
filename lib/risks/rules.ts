import type { Passport, RiskCard } from "@/lib/types";

// Слой 1 — детерминированные правила противоречий. Всегда source='rule',
// confidence='high'. Тестируются. Тон карточек — продуктовое правило:
// «Возможный риск… Рекомендуем обсудить…», никогда «клиент противоречит себе».

type Answers = Record<string, unknown>;

// Собираем текстовый корпус из свободных полей для поиска ключевых слов.
function corpus(passport: Passport, answers: Answers): string {
  const parts: string[] = [
    passport.style.notes,
    passport.style.refs.join(" "),
    passport.style.anti.join(" "),
    passport.pain_points,
  ];
  // сырые ответы style на случай, если что-то не попало в паспорт
  const style = answers["style"];
  if (style && typeof style === "object") {
    parts.push(JSON.stringify(style));
  }
  return parts.join(" ").toLowerCase();
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((n) => text.includes(n));
}

const PREMIUM_MATERIALS = [
  "натуральн", "камень", "мрамор", "оникс", "травертин", "массив",
  "латунь", "бронз", "премиал", "премиум", "итальянск", "дорог",
];
const DEEP_CUSTOM = [
  "индивидуальн", "на заказ", "кастом", "столярк", "столярн",
  "встроенн", "уникальн", "по эскиз",
];
const CUSTOM_FURNITURE = [
  "мебель на заказ", "индивидуальн мебель", "столярк", "столярн", "на заказ",
];
const MINIMALISM = ["минимализм", "минимал"];

export function evaluateRules(passport: Passport, answers: Answers = {}): RiskCard[] {
  const text = corpus(passport, answers);
  const cards: RiskCard[] = [];

  // 1. Низкий/средний бюджет + премиальные материалы.
  if (
    passport.budget.range !== "undisclosed" &&
    (passport.budget.risk_level === "low" || passport.budget.risk_level === "mid") &&
    hasAny(text, PREMIUM_MATERIALS)
  ) {
    cards.push({
      risk_type: "budget",
      evidence: [
        "В пожеланиях по стилю упомянуты премиальные/натуральные материалы",
        `Бюджетный уровень: ${passport.budget.risk_level === "low" ? "эконом" : "средний"}`,
      ],
      impact: "Стоимость материалов и итоговая смета проекта",
      confidence: "high",
      designer_action:
        "Уточнить приоритет: где натуральный материал критичен, а где допустима качественная замена.",
      proposal_implication:
        "В «что входит» зафиксировать материалы акцентно; в «что не входит» — сплошную отделку премиум-материалами.",
      source: "rule",
    });
  }

  // 2. Продажа/аренда + глубокая кастомизация.
  if (
    (passport.asset_horizon === "sell_2_5y" || passport.asset_horizon === "rent") &&
    hasAny(text, DEEP_CUSTOM)
  ) {
    cards.push({
      risk_type: "budget",
      evidence: [
        `Горизонт актива: ${passport.asset_horizon === "rent" ? "аренда" : "продажа через 2–5 лет"}`,
        "В пожеланиях — глубокая кастомизация (индивидуальные/встроенные решения)",
      ],
      impact: "Окупаемость вложений, бюджет и состав работ",
      confidence: "high",
      designer_action:
        "Обсудить, что при продаже/аренде глубокая кастомизация плохо окупается — где разумно упростить.",
      proposal_implication:
        "Предложить пакет с типовыми решениями; кастомизацию вынести в отдельную опцию.",
      source: "rule",
    });
  }

  // 3. Срочность + индивидуальная мебель.
  if (passport.timeline.urgency === "urgent" && hasAny(text, CUSTOM_FURNITURE)) {
    cards.push({
      risk_type: "timeline",
      evidence: [
        "Срочные сроки (до 3–4 месяцев)",
        "В пожеланиях — мебель на заказ / столярка",
      ],
      impact: "Сроки проекта: изготовление мебели на заказ — 6–10+ недель",
      confidence: "high",
      designer_action:
        "Согласовать приоритеты: что заказать первым, где взять готовые аналоги под срок.",
      proposal_implication:
        "В условиях зафиксировать, что срок зависит от сроков поставки мебели на заказ.",
      source: "rule",
    });
  }

  // 4. Высокая нагрузка на хранение + минимализм.
  if (passport.lifestyle.storage_pressure === "high" && hasAny(text, MINIMALISM)) {
    cards.push({
      risk_type: "function",
      evidence: [
        "Высокая нагрузка на хранение (многое не помещается)",
        "В стиле заявлен минимализм",
      ],
      impact: "Функциональность: минимализм визуально конфликтует с объёмом хранения",
      confidence: "high",
      designer_action:
        "Обсудить закрытые системы хранения, которые сохраняют минималистичный вид.",
      proposal_implication:
        "В состав работ включить проект систем хранения; в «что входит» — скрытое хранение.",
      source: "rule",
    });
  }

  // 5. Высокая утренняя нагрузка + один санузел.
  if (passport.lifestyle.morning_load === "high" && passport.lifestyle.bathrooms === 1) {
    cards.push({
      risk_type: "function",
      evidence: [
        "Высокая утренняя нагрузка (3+ человека одновременно)",
        "Сейчас один санузел",
      ],
      impact: "Эргономика утреннего сценария, возможная перепланировка санузла",
      confidence: "high",
      designer_action:
        "Обсудить второй санузел / раздельный санузел / два умывальника — что позволяет планировка.",
      proposal_implication:
        "Если нужна перепланировка санузла — включить в состав работ и в сроки согласований.",
      source: "rule",
    });
  }

  // 6. Перепланировка + срочность → сроки (согласования не совместимы со спешкой).
  if (passport.object.replanning === "yes" && passport.timeline.urgency === "urgent") {
    cards.push({
      risk_type: "timeline",
      evidence: ["Планируется перепланировка", "Срочные сроки (до 3–4 месяцев)"],
      impact: "Сроки: согласование перепланировки (БТИ/УК) может занять недели-месяцы",
      confidence: "high",
      designer_action:
        "Объяснить сроки узаконивания перепланировки; обсудить, что можно начать без неё.",
      proposal_implication:
        "В сроках зафиксировать зависимость от согласования перепланировки; вынести узаконивание отдельно.",
      source: "rule",
    });
  }

  // 7. Низкий/средний бюджет, в который «включена мебель» → бюджет (тесно).
  if (
    passport.budget.range !== "undisclosed" &&
    (passport.budget.risk_level === "low" || passport.budget.risk_level === "mid") &&
    passport.budget.includes_furniture === "yes"
  ) {
    cards.push({
      risk_type: "budget",
      evidence: [
        `Бюджетный уровень: ${passport.budget.risk_level === "low" ? "эконом" : "средний"}`,
        "В этот бюджет клиент закладывает и мебель с техникой",
      ],
      impact: "Бюджет: на комплектацию после ремонтных работ может не остаться средств",
      confidence: "high",
      designer_action:
        "Развести бюджет на работы и на комплектацию; показать реалистичную долю на мебель.",
      proposal_implication:
        "В КП явно разделить стоимость проекта, ремонта и комплектации; в exclusions — закупку мебели.",
      source: "rule",
    });
  }

  // 9. Много отдельных зон при небольшой площади → функция (не всё влезет).
  if (
    passport.object.area_m2 !== null &&
    passport.object.area_m2 < 55 &&
    (passport.rooms?.zones?.length ?? 0) >= 4
  ) {
    cards.push({
      risk_type: "function",
      evidence: [
        `Небольшая площадь (${passport.object.area_m2} м²)`,
        `Запрошено отдельных зон: ${passport.rooms?.zones?.length}`,
      ],
      impact: "Функция: все отдельные зоны могут не поместиться — нужны совмещения",
      confidence: "high",
      designer_action:
        "Расставить приоритеты зон; предложить многофункциональные решения (кабинет в нише, гостевая-трансформер).",
      proposal_implication:
        "В состав работ включить проработку многофункционального зонирования вместо отдельных комнат.",
      source: "rule",
    });
  }

  // 8. Присоединение балкона → технический/юридический риск.
  if (passport.rooms?.balcony === "attach") {
    cards.push({
      risk_type: "technical",
      evidence: ["Клиент хочет присоединить/утеплить балкон как жилую комнату"],
      impact: "Согласование: снос порога и вынос отопления на балкон обычно не узаконивается",
      confidence: "high",
      designer_action:
        "Объяснить ограничения: французское остекление и тёплый пол вместо радиатора; что можно узаконить.",
      proposal_implication:
        "В КП зафиксировать, что присоединение балкона — по согласованию; вынести узаконивание отдельно.",
      source: "rule",
    });
  }

  return cards;
}
