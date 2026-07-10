import type { AnswersMap, Passport, ProposalSection, RiskCard } from "@/lib/types";
import type {
  ConceptPack,
  ConceptPackage,
  ConceptPackSection,
} from "@/lib/concept/schema";

export type ConceptRiskInput = Pick<
  RiskCard,
  "risk_type" | "impact" | "designer_action" | "proposal_implication"
>;

export interface BuildConceptPackArgs {
  passport: Passport;
  answers?: AnswersMap;
  acceptedRisks?: ConceptRiskInput[];
  package?: ConceptPackage | null;
  proposalSections?: ProposalSection[];
}

const OBJECT_LABEL: Record<string, string> = {
  flat: "квартиры",
  house: "дома",
  apartments: "апартаментов",
};

const PACKAGE_LABEL: Record<ConceptPackage, string> = {
  concept: "концепция",
  full: "полный дизайн-проект",
  full_plus_supervision: "полный дизайн-проект с сопровождением",
};

const STYLE_LABEL: Record<string, string> = {
  modern: "современный интерьер",
  scandi: "мягкий скандинавский интерьер",
  minimal: "тёплый минимализм",
  neoclassic: "сдержанная неоклассика",
  classic: "современная классика",
  loft: "мягкий лофт",
  japandi: "джапанди и природный минимализм",
  provence: "современная интерпретация кантри",
};

const STYLE_NOTE_NEEDLE: Record<string, string> = {
  modern: "соврем",
  scandi: "сканди",
  minimal: "минимал",
  neoclassic: "неокласс",
  classic: "классик",
  loft: "лофт",
  japandi: "джапанди",
  provence: "прованс",
};

const ZONE_LABEL: Record<string, string> = {
  kids: "Детская",
  office: "Кабинет / рабочее место",
  walkin: "Гардеробная",
  master_ensuite: "Мастер-блок",
  guest: "Гостевая спальня",
  dining: "Столовая",
  laundry: "Постирочная / кладовая",
  gym: "Спортзона",
  library: "Библиотека",
  hobby: "Мастерская / хобби",
};

const RISK_LABEL: Record<RiskCard["risk_type"], string> = {
  budget: "Бюджет",
  timeline: "Сроки",
  function: "Функция",
  style: "Стиль",
  technical: "Техническая часть",
};

const PALETTES: Record<
  NonNullable<Passport["style"]["palette"]> | "neutral",
  Pick<ConceptPack["palette_direction"], "base" | "accents" | "materials" | "note">
> = {
  light: {
    base: ["молочный", "мягкий серо-бежевый"],
    accents: ["светлое дерево", "матовый графит"],
    materials: ["светлый дуб", "фактурный текстиль", "матовая керамика"],
    note: "Светлая база должна держаться на разнице фактур, а не на стерильном белом цвете.",
  },
  dark: {
    base: ["глубокий серо-коричневый", "дымчатый графит"],
    accents: ["тёплое дерево", "приглушённая латунь"],
    materials: ["тонированный шпон", "камень", "плотный текстиль"],
    note: "Тёмные поверхности уравновесить локальным светом и тёплыми тактильными материалами.",
  },
  warm: {
    base: ["песочный", "льняной", "тёплый greige"],
    accents: ["терракота", "оливковый"],
    materials: ["натуральный дуб", "лён", "травертин или его спокойный аналог"],
    note: "Сохранять невысокий контраст и собирать глубину через природные оттенки и фактуры.",
  },
  cool: {
    base: ["светлый серый", "холодный greige"],
    accents: ["пыльно-синий", "графит"],
    materials: ["серый камень", "светлое дерево", "матовый металл"],
    note: "Добавить дерево и мягкий текстиль, чтобы холодная база не стала визуально жёсткой.",
  },
  contrast: {
    base: ["молочный", "графитовый"],
    accents: ["тёплое дерево", "один глубокий цвет"],
    materials: ["контрастный шпон", "камень", "матовый металл"],
    note: "Контраст использовать крупными плоскостями; мелкую пестроту и конкурирующие акценты исключить.",
  },
  neutral: {
    base: ["тёплый светлый нейтральный", "мягкий greige"],
    accents: ["натуральное дерево", "приглушённый графит"],
    materials: ["дерево", "матовая минеральная фактура", "натуральный текстиль"],
    note: "Это стартовая гипотеза: финальные оттенки подтвердить по референсам и образцам материалов.",
  },
};

function unique(items: Array<string | undefined | null>): string[] {
  return [...new Set(items.map((item) => item?.trim()).filter((item): item is string => Boolean(item)))];
}

function maskPrivateText(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[контакт скрыт]")
    .replace(/(?:\+?7|8)[\s().-]*\d{3}[\s().-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/g, "[контакт скрыт]")
    .replace(/(^|\s)@[a-z0-9_]{3,}/gi, "$1[контакт скрыт]");
}

function sentence(value: string, fallback: string): string {
  const clean = (maskPrivateText(value).trim() || maskPrivateText(fallback).trim()).replace(
    /\s+/g,
    " ",
  );
  if (!clean) return fallback;
  return /[.!?…]$/.test(clean) ? clean : `${clean}.`;
}

function resolvePackage(args: BuildConceptPackArgs): ConceptPackage {
  if (args.package) return args.package;
  if (args.passport.scope.package) return args.passport.scope.package;
  return "concept";
}

function styleTitle(passport: Passport): string {
  const directions = unique(
    (passport.style.directions ?? []).map((item) => STYLE_LABEL[item] ?? maskPrivateText(item)),
  );
  if (directions.length > 0) return directions.join(" + ");
  const notes = passport.style.notes.toLowerCase();
  const inferred = Object.entries(STYLE_LABEL).find(([code]) =>
    notes.includes(STYLE_NOTE_NEEDLE[code] ?? code),
  );
  if (inferred) return inferred[1];
  if (passport.style.notes.trim()) return "Индивидуальное современное направление";
  return "Спокойный современный интерьер с природными фактурами";
}

function buildStyleDirection(
  passport: Passport,
  risks: ConceptRiskInput[],
): ConceptPack["style_direction"] {
  const title = styleTitle(passport);
  const palette = passport.style.palette
    ? `Палитра — ${
        {
          light: "светлая",
          dark: "тёмная",
          warm: "тёплая нейтральная",
          cool: "холодная",
          contrast: "контрастная",
        }[passport.style.palette]
      }.`
    : "Палитру держать нейтральной до сверки с референсами.";

  const principles = unique([
    "Собрать единый спокойный фон и повторять ключевые материалы между зонами.",
    passport.lifestyle.storage_pressure === "high"
      ? "Интегрировать хранение в архитектуру стен и сохранять визуально чистые поверхности."
      : "Сочетать закрытое хранение с несколькими осмысленными открытыми акцентами.",
    passport.household.kids || passport.household.pets
      ? "Выбирать износостойкие, моющиеся и тактильно комфортные покрытия."
      : null,
    passport.lifestyle.cooking === "heavy"
      ? "В кухне приоритетны практичные матовые поверхности и сценарный рабочий свет."
      : null,
    passport.style.refs.length > 0
      ? `Сверять решения с ${passport.style.refs.length} референсами клиента, отделяя атмосферу от буквального копирования.`
      : "До фиксации деталей собрать 3–5 сопоставимых референсов по атмосфере, материалам и свету.",
    passport.style.notes.trim()
      ? `Смысловой ориентир клиента: ${sentence(passport.style.notes.slice(0, 220), "уточнить на встрече")}`
      : null,
    ...risks
      .filter((risk) => risk.risk_type === "style")
      .map((risk) => sentence(risk.designer_action, risk.impact)),
  ]);

  const avoid = unique([
    ...passport.style.anti.map((item) => sentence(item, item)),
    ...risks
      .filter((risk) => risk.risk_type === "style")
      .map((risk) => sentence(risk.impact, risk.designer_action)),
    passport.style.anti.length === 0
      ? "Случайных декоративных приёмов и материалов, которые не поддерживают общую систему."
      : null,
  ]);

  return {
    title,
    rationale: `${palette} Направление должно поддерживать бытовые сценарии и оставаться цельным во всех основных зонах.`,
    principles,
    avoid,
  };
}

function materialAdditions(passport: Passport): string[] {
  const directions = passport.style.directions ?? [];
  return unique([
    directions.some((item) => ["scandi", "japandi", "provence"].includes(item))
      ? "выразительная натуральная древесина"
      : null,
    directions.includes("minimal") ? "крупные матовые однотонные плоскости" : null,
    directions.includes("loft") ? "минеральная фактура и тёмный металл" : null,
    directions.some((item) => ["classic", "neoclassic"].includes(item))
      ? "камень и деликатный металлический акцент"
      : null,
  ]);
}

function isPaletteKey(
  value: string | undefined,
): value is Exclude<keyof typeof PALETTES, "neutral"> {
  return value === "light" || value === "dark" || value === "warm" || value === "cool" || value === "contrast";
}

function buildPalette(passport: Passport, risks: ConceptRiskInput[]): ConceptPack["palette_direction"] {
  const key = isPaletteKey(passport.style.palette) ? passport.style.palette : "neutral";
  const palette = PALETTES[key]!;
  const budgetRisk = risks.find((risk) => risk.risk_type === "budget");
  const materials = unique([...palette.materials, ...materialAdditions(passport)]);
  const note = budgetRisk
    ? `${palette.note} ${sentence(budgetRisk.proposal_implication, budgetRisk.designer_action)}`
    : palette.note;
  return { ...palette, materials, note };
}

function buildMoodboard(
  passport: Passport,
  style: ConceptPack["style_direction"],
  palette: ConceptPack["palette_direction"],
): ConceptPack["moodboard_outline"] {
  const anti =
    passport.style.anti.length > 0
      ? maskPrivateText(passport.style.anti.join(", "))
      : "лишний декор";
  return {
    direction: `Мудборд должен проверить гипотезу «${style.title}» через атмосферу, материалы, формы, свет и детали — без генерации изображений.`,
    frames: [
      {
        id: "atmosphere",
        title: "Атмосфера и композиция",
        brief: "2–3 кадра с нужной плотностью интерьера, масштабом предметов и уровнем визуального спокойствия.",
        search_prompts: [
          `${style.title}, цельный жилой интерьер`,
          `${style.title}, ${palette.base.join(" и ")}, естественный свет`,
        ],
      },
      {
        id: "materials",
        title: "Материалы и фактуры",
        brief: `Собрать сочетание: ${palette.materials.join(", ")}. Показывать материалы крупно и в реальном соседстве.`,
        search_prompts: [
          `${style.title}, сочетание ${palette.materials.slice(0, 2).join(" и ")}`,
          `${palette.base[0]}, ${palette.accents[0]}, интерьерные материалы`,
        ],
      },
      {
        id: "forms",
        title: "Мебель и формы",
        brief: "Зафиксировать геометрию корпусной и мягкой мебели, ритм фасадов и характер фурнитуры.",
        search_prompts: [
          `${style.title}, мебель простые формы`,
          `${style.title}, встроенное хранение и мягкая мебель`,
        ],
      },
      {
        id: "lighting",
        title: "Световые сценарии",
        brief: "Показать общий, рабочий и вечерний свет; избегать кадра, где декоративный свет заменяет функциональный.",
        search_prompts: [
          `${style.title}, многоуровневое освещение`,
          `${style.title}, тёплый вечерний свет интерьер`,
        ],
      },
      {
        id: "details",
        title: "Детали и анти-референсы",
        brief: `Выбрать 2–3 характерных детали и рядом зафиксировать, чего избегаем: ${anti}.`,
        search_prompts: [
          `${style.title}, сдержанные интерьерные детали`,
          `анти-референс: ${anti}`,
        ],
      },
    ],
  };
}

function cookingPeople(answers: AnswersMap | undefined): number | null {
  const value = answers?.cooking_people;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function buildRoomDirections(
  passport: Passport,
  answers: AnswersMap | undefined,
): ConceptPack["room_directions"] {
  const result: ConceptPack["room_directions"] = [];
  const functionalPriority =
    passport.lifestyle.storage_pressure === "high"
      ? "Планировать закрытое хранение до выбора декоративных решений."
      : "Сохранять свободные проходы и понятную иерархию предметов.";

  result.push({
    id: "whole_project",
    zone: "Общая пространственная логика",
    concept: "Связать помещения повторяющимися материалами и светом, но дать каждой зоне собственный функциональный акцент.",
    priorities: unique([
      functionalPriority,
      passport.object.area_m2
        ? `Проверять плотность решений в масштабе ${passport.object.area_m2} м².`
        : "Подтвердить площадь и обмеры до фиксации пропорций.",
      passport.object.replanning && passport.object.replanning !== "no"
        ? "Не закреплять планировочные обещания до технической проверки перепланировки."
        : null,
    ]),
  });

  const living = passport.rooms?.living;
  if (living && living !== "none") {
    const open = living === "open" || living === "kitchen_living_dining";
    result.push({
      id: "living",
      zone: open ? "Кухня-гостиная" : "Гостиная",
      concept: open
        ? "Собрать общее пространство вокруг одного композиционного центра и разделить функции светом, мебелью и ковровой группой."
        : "Сделать гостиную спокойной самостоятельной зоной общения без конкурирующих визуальных центров.",
      priorities: unique([
        "Сохранить удобные маршруты между входом, посадкой и соседними помещениями.",
        passport.household.kids || passport.household.pets
          ? "Выбрать устойчивые к ежедневной нагрузке ткани и покрытия."
          : "Предусмотреть дневной и вечерний сценарии посадки.",
      ]),
    });
  }

  if (passport.rooms?.kitchen || passport.lifestyle.cooking !== "none") {
    const layout = passport.rooms?.kitchen?.layout;
    const people = cookingPeople(answers);
    result.push({
      id: "kitchen",
      zone: "Кухня и обеденная зона",
      concept:
        passport.lifestyle.cooking === "heavy"
          ? "Рабочая кухня с визуально собранными фасадами: техника и хранение интегрированы, рабочие зоны хорошо освещены."
          : "Лаконичная кухня, которая поддерживает общий интерьер и не перегружает жилое пространство.",
      priorities: unique([
        layout ? `Проверить эргономику выбранной схемы «${layout}» на обмерах.` : "Выбрать планировку после проверки рабочих проходов.",
        people ? `Обеденную и рабочую зоны проверить для сценария на ${people} чел.` : null,
        passport.rooms?.kitchen?.dining
          ? `Учесть обеденный сценарий: ${passport.rooms.kitchen.dining}.`
          : "Уточнить размер постоянной обеденной группы.",
      ]),
    });
  }

  if (passport.rooms?.bedrooms) {
    result.push({
      id: "bedrooms",
      zone: "Спальные комнаты",
      concept: "Снизить визуальный шум, выстроить симметрию или спокойный ритм и отделить вечерний свет от общего.",
      priorities: unique([
        `Предусмотреть требуемое количество спален: ${passport.rooms.bedrooms}.`,
        "Сначала определить хранение, розетки и свет у кровати, затем декоративный слой.",
      ]),
    });
  }

  if (passport.rooms?.bath || passport.lifestyle.bathrooms) {
    result.push({
      id: "bathrooms",
      zone: "Санузлы",
      concept: "Продолжить общую палитру проекта более практичными материалами и ясным функциональным зонированием.",
      priorities: unique([
        passport.lifestyle.morning_load === "high"
          ? "Развести одновременные утренние сценарии и проверить достаточность точек пользования."
          : "Разделить общий, зеркальный и ночной свет.",
        passport.rooms?.bath?.sinks === "two" ? "Проверить ширину столешницы под две раковины." : null,
        passport.rooms?.bath?.shower ? `Учесть сценарий «${passport.rooms.bath.shower}».` : null,
      ]),
    });
  }

  if ((passport.rooms?.hallway?.length ?? 0) > 0 || passport.lifestyle.storage_pressure !== "low") {
    result.push({
      id: "entry_storage",
      zone: "Прихожая и хранение",
      concept: "Сделать хранение частью архитектуры: крупные спокойные фасады, открытые ниши только в точках ежедневного использования.",
      priorities: unique([
        functionalPriority,
        passport.rooms?.hallway?.includes("stroller")
          ? "Заложить отдельный объём для коляски или велосипеда без перекрытия прохода."
          : null,
        passport.rooms?.hallway?.includes("seat") ? "Предусмотреть место для посадки у входа." : null,
      ]),
    });
  }

  for (const zoneId of passport.rooms?.zones ?? []) {
    const zone = ZONE_LABEL[zoneId] ?? zoneId;
    if (result.some((item) => item.zone === zone)) continue;
    result.push({
      id: `zone_${zoneId.replace(/[^a-z0-9_]/gi, "_")}`,
      zone,
      concept: "Выделить зону светом, мебелью и хранением, сохранив связь с общей стилистической системой проекта.",
      priorities: ["Уточнить сценарий использования, необходимое оборудование и степень приватности."],
    });
  }

  if (passport.rooms?.balcony && !["none", "asis"].includes(passport.rooms.balcony)) {
    result.push({
      id: "balcony",
      zone: "Балкон / лоджия",
      concept:
        passport.rooms.balcony === "lounge"
          ? "Продолжить интерьер компактной зоной отдыха с устойчивыми к перепадам температуры материалами."
          : passport.rooms.balcony === "storage"
            ? "Организовать закрытое сезонное хранение и сохранить свободный световой фронт."
            : "Рассматривать присоединение только как техническую гипотезу после проверки допустимости.",
      priorities: [
        passport.rooms.balcony === "attach"
          ? "Проверить конструктивные и юридические ограничения до включения решения в концепцию."
          : "Уточнить утепление, свет и сценарий круглогодичного использования.",
      ],
    });
  }

  return result;
}

function buildDesignerNotes(
  passport: Passport,
  risks: ConceptRiskInput[],
  packageChoice: ConceptPackage,
  proposalSections: ProposalSection[],
): string[] {
  const proposalScope = proposalSections
    .filter((section) => ["package", "works", "included", "excluded"].includes(section.id))
    .filter((section) => section.body.trim())
    .slice(0, 3)
    .map(
      (section) =>
        `Сверить с КП «${maskPrivateText(section.title)}»: ${sentence(
          section.body.slice(0, 280),
          "проверить сохранённый состав работ",
        )}`,
    );
  return unique([
    `Рабочая рамка Concept Pack: ${PACKAGE_LABEL[packageChoice]}.`,
    proposalSections.length > 0
      ? "Сверить финальные решения Concept Pack с уже сохранённым составом коммерческого предложения."
      : null,
    ...proposalScope,
    passport.style.refs.length === 0
      ? "Запросить 3–5 стилевых референсов до фиксации материалов и предметов."
      : `Разложить ${passport.style.refs.length} референсов на атмосферу, материалы, формы и свет; не копировать кадры буквально.`,
    passport.object.area_m2 ? null : "До детализации зон получить актуальные обмеры и точную площадь.",
    passport.budget.range === "undisclosed"
      ? "Не фиксировать конкретные бренды и материалы до согласования бюджетного коридора."
      : "Каждый материальный приём сверять с бюджетом ремонта и комплектации.",
    passport.timeline.urgency === "urgent"
      ? "Приоритет отдавать доступным материалам и решениям без длинного индивидуального производства."
      : null,
    ...risks.map(
      (risk) =>
        `${RISK_LABEL[risk.risk_type]}: ${sentence(
          risk.designer_action,
          sentence(risk.impact, "Проверить влияние принятого риска на концепцию"),
        )}`,
    ),
    ...risks
      .filter((risk) => risk.proposal_implication.trim())
      .map(
        (risk) =>
          `Для scope: ${sentence(risk.proposal_implication, "Зафиксировать следствие риска в составе работ")}`,
      ),
  ]).slice(0, 12);
}

function projectSummary(
  passport: Passport,
  style: ConceptPack["style_direction"],
  packageChoice: ConceptPackage,
): string {
  const object = passport.object.type ? OBJECT_LABEL[passport.object.type] : "объекта";
  const area = passport.object.area_m2 ? ` площадью ${passport.object.area_m2} м²` : "";
  const purpose = {
    self_long: "для долгой жизни владельцев",
    sell_2_5y: "с учётом возможной продажи через 2–5 лет",
    rent: "для последующей аренды",
    unknown: "с пока неуточнённым горизонтом использования",
  }[passport.asset_horizon];
  const pain = passport.pain_points.trim()
    ? ` Главная задача — ${sentence(passport.pain_points, passport.pain_points).toLowerCase()}`
    : " Главную бытовую проблему нужно подтвердить на первой встрече.";

  return `Concept Pack задаёт направление «${style.title}» для ${object}${area} ${purpose}. Рабочая рамка — ${PACKAGE_LABEL[packageChoice]}.${pain}`;
}

function clientSummary(
  passport: Passport,
  style: ConceptPack["style_direction"],
  palette: ConceptPack["palette_direction"],
  packageChoice: ConceptPackage,
  rooms: ConceptPack["room_directions"],
): string {
  const lifestyle = passport.lifestyle.storage_pressure === "high"
    ? "с продуманным встроенным хранением"
    : "с ясным зонированием и удобными ежедневными сценариями";
  const priorityZones = rooms
    .filter((room) => room.id !== "whole_project")
    .slice(0, 3)
    .map((room) => room.zone.toLowerCase());
  const zones = priorityZones.length > 0
    ? ` В первую очередь проработаем ${priorityZones.join(", ")}.`
    : " Пространственную логику уточним после проверки планировки и обмеров.";
  const focus = passport.pain_points.trim()
    ? ` Отдельный фокус — ${sentence(passport.pain_points, passport.pain_points).toLowerCase()}`
    : "";
  return `Предлагаем развивать интерьер в направлении «${style.title}»: цельный, спокойный и практичный, ${lifestyle}. Основу составят ${palette.base.join(" и ")}, ${palette.materials.slice(0, 2).join(" и ")}; акценты — ${palette.accents.join(" и ")}. Рабочая рамка проекта — ${PACKAGE_LABEL[packageChoice]}.${zones}${focus} На следующем шаге направление нужно подтвердить референсами и образцами, а затем адаптировать к каждой комнате и реальному бюджету проекта.`;
}

function buildSections(pack: Omit<ConceptPack, "concept_sections">): ConceptPackSection[] {
  return [
    {
      id: "summary",
      kind: "summary",
      title: "Концепция проекта",
      body: pack.project_summary,
      bullets: [],
    },
    {
      id: "style_direction",
      kind: "style",
      title: "Стилевое направление",
      body: `${pack.style_direction.title}. ${pack.style_direction.rationale}`,
      bullets: [...pack.style_direction.principles, ...pack.style_direction.avoid.map((item) => `Избегать: ${item}`)],
    },
    {
      id: "moodboard_outline",
      kind: "moodboard",
      title: "Структура мудборда",
      body: pack.moodboard_outline.direction,
      bullets: pack.moodboard_outline.frames.map((frame) => `${frame.title}: ${frame.brief}`),
    },
    {
      id: "palette_direction",
      kind: "palette",
      title: "Направление палитры",
      body: pack.palette_direction.note,
      bullets: [
        `База: ${pack.palette_direction.base.join(", ")}`,
        `Акценты: ${pack.palette_direction.accents.join(", ")}`,
        `Материалы: ${pack.palette_direction.materials.join(", ")}`,
      ],
    },
    ...pack.room_directions.map<ConceptPackSection>((room) => ({
      id: `room_${room.id}`,
      kind: "room",
      title: room.zone,
      body: room.concept,
      bullets: room.priorities,
    })),
    {
      id: "designer_notes",
      kind: "designer_notes",
      title: "Заметки для дизайнера",
      body: "Решения, которые нужно проверить до развития концепции.",
      bullets: pack.designer_notes,
    },
    {
      id: "client_summary",
      kind: "client_summary",
      title: "Резюме для клиента",
      body: pack.client_ready_summary,
      bullets: [],
    },
  ];
}

// Первый vertical slice Module 2: чистая и детерминированная сборка.
// Никаких сетевых вызовов, LLM или анализа загруженных изображений.
export function buildConceptPackFromPassport(args: BuildConceptPackArgs): ConceptPack {
  const risks = [...(args.acceptedRisks ?? [])].sort((left, right) =>
    `${left.risk_type}\u0000${left.designer_action}\u0000${left.proposal_implication}`.localeCompare(
      `${right.risk_type}\u0000${right.designer_action}\u0000${right.proposal_implication}`,
      "ru",
    ),
  );
  const packageChoice = resolvePackage(args);
  const style = buildStyleDirection(args.passport, risks);
  const palette = buildPalette(args.passport, risks);
  const moodboard = buildMoodboard(args.passport, style, palette);
  const rooms = buildRoomDirections(args.passport, args.answers);
  const proposalSections = args.proposalSections ?? [];
  const proposalUsed = proposalSections.length > 0;
  const notes = buildDesignerNotes(args.passport, risks, packageChoice, proposalSections);

  const pack: Omit<ConceptPack, "concept_sections"> = {
    version: 1,
    status: "ready",
    source: {
      package: packageChoice,
      answer_count: Object.keys(args.answers ?? {}).length,
      accepted_risk_count: risks.length,
      proposal_present: proposalUsed,
    },
    project_summary: projectSummary(args.passport, style, packageChoice),
    style_direction: style,
    moodboard_outline: moodboard,
    palette_direction: palette,
    room_directions: rooms,
    designer_notes: notes,
    client_ready_summary: clientSummary(args.passport, style, palette, packageChoice, rooms),
  };

  return { ...pack, concept_sections: buildSections(pack) };
}
