// Источник истины для quick brief. 10 вопросов, архитектура JTBD.
// Тон поведенческий, не прямой (см. CLAUDE.md): не «нужна ли ванна», а «как
// проходит утро». Никаких вопросов про доход — только поведенческие прокси.
//
// Каждый вопрос несёт три атрибута из стратегии:
//   passport_field — куда пишется ответ в projects.passport
//   show_if        — условие показа (ветвление)
//   (правило противоречия живёт отдельно, в lib/risks/rules.ts)

export type QuestionType = "object" | "choice" | "multi" | "number" | "text" | "budget" | "style" | "files";

export interface Option {
  value: string;
  label: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  title: string;
  help?: string;
  optional?: boolean;
  passport_field: string;
  options?: Option[];
  // Ветвление: вопрос показывается, только если предикат от текущих answers истинен.
  show_if?: (answers: Record<string, unknown>) => boolean;
}

// Хелпер: достать выбранное значение choice-ответа.
function choiceValue(answers: Record<string, unknown>, id: string): string | undefined {
  const v = answers[id];
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "value" in v) return String((v as { value: unknown }).value);
  return undefined;
}

export const QUESTIONS: Question[] = [
  {
    id: "object",
    type: "object",
    title: "Что за объект и где он?",
    help: "Тип, площадь и город. Это задаёт масштаб проекта.",
    passport_field: "object",
  },
  {
    id: "condition",
    type: "choice",
    title: "В каком состоянии объект сейчас?",
    help: "От этого зависит объём демонтажа, сроки и бюджет.",
    passport_field: "object.condition",
    options: [
      { value: "shell", label: "Пустая коробка (новостройка без отделки)" },
      { value: "rough", label: "Черновая отделка" },
      { value: "lived", label: "Жилое, с ремонтом — нужен демонтаж" },
    ],
  },
  {
    id: "replanning",
    type: "choice",
    title: "Планируете менять планировку?",
    help: "Двигать стены, объединять комнаты, переносить кухню/санузел.",
    passport_field: "object.replanning",
    options: [
      { value: "no", label: "Нет, оставляем как есть" },
      { value: "maybe", label: "Пока думаем" },
      { value: "yes", label: "Да, хотим менять" },
    ],
  },
  {
    id: "asset_horizon",
    type: "choice",
    title: "Что будет с этим жильём через 3–5 лет?",
    help: "Самый важный вопрос: он влияет и на бюджет, и на материалы, и на глубину кастомизации.",
    passport_field: "asset_horizon",
    options: [
      { value: "self_long", label: "Живём для себя, надолго" },
      { value: "sell_2_5y", label: "Возможно, продадим через 2–5 лет" },
      { value: "rent", label: "Будем сдавать в аренду" },
      { value: "unknown", label: "Пока не знаю" },
    ],
  },
  {
    id: "household",
    type: "multi",
    title: "Кто живёт сейчас и кто может добавиться за 5 лет?",
    help: "Ремонт делается не под текущую жизнь, а под следующую.",
    passport_field: "household",
    options: [
      { value: "kids_now", label: "Дети живут сейчас" },
      { value: "kids_future", label: "Планируем детей в ближайшие 5 лет" },
      { value: "parents", label: "Родители живут или будут приезжать надолго" },
      { value: "pets", label: "Животные" },
      { value: "alone_or_couple", label: "Только я / пара" },
    ],
  },
  {
    id: "decision_makers",
    type: "choice",
    title: "Кто будет принимать решения по проекту?",
    help: "Чтобы согласования шли гладко и без переделок.",
    passport_field: "household.decision_makers",
    options: [
      { value: "single", label: "Я один(одна)" },
      { value: "couple", label: "Вдвоём с партнёром" },
      { value: "family", label: "Вся семья / несколько человек" },
    ],
  },
  {
    id: "morning",
    type: "choice",
    title: "Как выглядит будний утренний час?",
    help: "Сколько человек собираются одновременно — и сколько сейчас санузлов.",
    passport_field: "lifestyle.morning_load",
    options: [
      { value: "low_1bath", label: "1–2 человека, спокойно (1 санузел)" },
      { value: "mid_1bath", label: "2–3 человека, есть очередь (1 санузел)" },
      { value: "high_1bath", label: "3+ человека одновременно, 1 санузел" },
      { value: "mid_2bath", label: "Несколько человек, 2+ санузла" },
    ],
  },
  {
    id: "bath_count",
    type: "choice",
    title: "Сколько санузлов хотите в итоге?",
    passport_field: "rooms.bath.count",
    options: [
      { value: "one", label: "Один совмещённый" },
      { value: "two", label: "Два санузла" },
      { value: "separate", label: "Раздельный (ванна и туалет отдельно)" },
      { value: "unknown", label: "Не знаю, доверю дизайнеру" },
    ],
  },
  {
    id: "bath_sinks",
    type: "choice",
    title: "Сколько раковин в ванной?",
    passport_field: "rooms.bath.sinks",
    options: [
      { value: "one", label: "Одна" },
      { value: "two", label: "Две" },
      { value: "unknown", label: "Не знаю" },
    ],
  },
  {
    id: "bath_shower",
    type: "choice",
    title: "Ванна или душ?",
    passport_field: "rooms.bath.shower",
    options: [
      { value: "bath", label: "Ванна" },
      { value: "shower", label: "Душевая" },
      { value: "both", label: "И ванна, и душ" },
      { value: "two_showers", label: "Два душевых места" },
      { value: "unknown", label: "Не знаю" },
    ],
  },
  {
    id: "cooking",
    type: "choice",
    title: "Готовите дома?",
    help: "Отсюда решение про кухню — а не из «хочу как в журнале».",
    passport_field: "lifestyle.cooking",
    options: [
      { value: "none", label: "Почти нет, еда на ходу" },
      { value: "basic", label: "Иногда, простое" },
      { value: "heavy", label: "Часто и с размахом" },
    ],
  },
  {
    id: "cooking_people",
    type: "number",
    title: "Обычно готовите на скольких человек?",
    passport_field: "lifestyle.cooking_people",
    optional: true,
    // Ветвление: спрашиваем про масштаб готовки только если готовят.
    show_if: (a) => choiceValue(a, "cooking") !== undefined && choiceValue(a, "cooking") !== "none",
  },
  {
    id: "kitchen_layout",
    type: "choice",
    title: "Какую планировку кухни хотите?",
    passport_field: "rooms.kitchen.layout",
    options: [
      { value: "linear", label: "Линейная (в одну стену)" },
      { value: "corner", label: "Угловая (Г-образная)" },
      { value: "u", label: "П-образная" },
      { value: "island", label: "С островом" },
      { value: "peninsula", label: "С полуостровом" },
      { value: "unknown", label: "Не знаю, доверю дизайнеру" },
    ],
  },
  {
    id: "kitchen_bar",
    type: "choice",
    title: "Нужна барная стойка?",
    passport_field: "rooms.kitchen.bar",
    options: [
      { value: "yes", label: "Да" },
      { value: "no", label: "Нет" },
      { value: "unknown", label: "Не знаю" },
    ],
  },
  {
    id: "kitchen_dining",
    type: "choice",
    title: "Обеденная зона на скольких человек?",
    passport_field: "rooms.kitchen.dining",
    options: [
      { value: "2", label: "На 2" },
      { value: "4", label: "На 4" },
      { value: "6plus", label: "На 6 и больше" },
      { value: "separate", label: "Отдельная столовая" },
      { value: "none", label: "Не нужна" },
    ],
  },
  {
    id: "storage",
    type: "multi",
    title: "Что сейчас не помещается?",
    help: "Поведенческий прокси к нагрузке на хранение.",
    passport_field: "lifestyle.storage_pressure",
    options: [
      { value: "clothes", label: "Одежда" },
      { value: "sport", label: "Спорт-инвентарь" },
      { value: "tech", label: "Техника / инструменты" },
      { value: "books", label: "Книги" },
      { value: "all_fits", label: "Всё помещается" },
    ],
  },
  {
    id: "furniture_keep",
    type: "choice",
    title: "Что с текущей мебелью?",
    help: "Влияет на планировку и на бюджет комплектации.",
    passport_field: "lifestyle.furniture_keep",
    options: [
      { value: "all_new", label: "Всё новое" },
      { value: "partial", label: "Часть оставим" },
      { value: "own", label: "Переезжаем со своей мебелью" },
    ],
  },
  {
    id: "budget",
    type: "budget",
    title: "Бюджетный коридор на ремонт и комплектацию",
    help: "Ориентир, не смета. Можно не называть.",
    passport_field: "budget.range",
  },
  {
    id: "budget_furniture",
    type: "choice",
    title: "Названный бюджет включает мебель и технику?",
    help: "Часто это считают отдельно — уточним сразу, чтобы не было сюрприза.",
    passport_field: "budget.includes_furniture",
    // Спрашиваем только если бюджет назвали (не «не готов назвать»).
    show_if: (a) => {
      const b = a["budget"];
      return Boolean(b && typeof b === "object" && Array.isArray((b as { range?: unknown }).range));
    },
    options: [
      { value: "yes", label: "Да, всё включено" },
      { value: "no", label: "Нет, только ремонт и работы" },
      { value: "unsure", label: "Не знаю" },
    ],
  },
  {
    id: "timeline",
    type: "choice",
    title: "Когда хотите закончить?",
    passport_field: "timeline",
    options: [
      { value: "flex", label: "Не спешим, важнее качество" },
      { value: "6_12m", label: "В течение 6–12 месяцев" },
      { value: "urgent", label: "Срочно — до 3–4 месяцев" },
    ],
  },
  {
    id: "deadline",
    type: "text",
    title: "Есть жёсткая дата, к которой нужно въехать?",
    help: "Например: свадьба, рождение ребёнка, конец аренды. Если нет — пропустите.",
    passport_field: "timeline.hard_deadline",
    optional: true,
  },
  {
    id: "style_direction",
    type: "multi",
    title: "Какие стилевые направления вам ближе?",
    help: "Можно выбрать несколько.",
    passport_field: "style.directions",
    options: [
      { value: "modern", label: "Современный" },
      { value: "scandi", label: "Скандинавский" },
      { value: "minimal", label: "Минимализм" },
      { value: "neoclassic", label: "Неоклассика" },
      { value: "classic", label: "Классика" },
      { value: "loft", label: "Лофт" },
      { value: "japandi", label: "Джапанди / эко" },
      { value: "provence", label: "Прованс / кантри" },
      { value: "unknown", label: "Пока не определилась" },
    ],
  },
  {
    id: "palette",
    type: "choice",
    title: "Какая палитра вам нравится?",
    passport_field: "style.palette",
    options: [
      { value: "light", label: "Светлая" },
      { value: "dark", label: "Тёмная" },
      { value: "warm", label: "Тёплая нейтральная" },
      { value: "cool", label: "Холодная" },
      { value: "contrast", label: "Контрастная (тёмное + светлое)" },
      { value: "unknown", label: "Не знаю" },
    ],
  },
  {
    id: "style",
    type: "style",
    title: "Стиль: референсы и что точно НЕ нравится",
    help: "3–5 референсов (ссылки) и то, что раздражает. «Не вот это» иногда важнее «хочу вот это».",
    passport_field: "style",
  },
  {
    id: "pain",
    type: "text",
    title: "Что больше всего раздражает в текущем жилье?",
    help: "Свободный текст.",
    passport_field: "pain_points",
  },
  {
    id: "requirements",
    type: "multi",
    title: "Есть особые требования?",
    help: "Отметьте всё, что актуально.",
    passport_field: "lifestyle.requirements",
    optional: true,
    options: [
      { value: "warm_floor", label: "Тёплый пол" },
      { value: "ac", label: "Кондиционирование" },
      { value: "smart", label: "Умный дом" },
      { value: "allergy", label: "Аллергии / гипоаллергенные материалы" },
      { value: "accessibility", label: "Маломобильные члены семьи" },
      { value: "soundproof", label: "Шумоизоляция" },
      { value: "none", label: "Нет особых требований" },
    ],
  },
  {
    id: "attachments",
    type: "files",
    title: "План БТИ или фото квартиры",
    help: "Необязательно. Только хранение — анализом изображений мы пока не занимаемся.",
    passport_field: "attachments",
    optional: true,
  },
];

// Вопросы, видимые при данном наборе ответов (учёт ветвления).
export function visibleQuestions(answers: Record<string, unknown>): Question[] {
  return QUESTIONS.filter((q) => !q.show_if || q.show_if(answers));
}

export function questionById(id: string): Question | undefined {
  return QUESTIONS.find((q) => q.id === id);
}
