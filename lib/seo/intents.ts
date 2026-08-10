// Реестр поисковых интентов (28 шт.) с вердиктом честности и картой маршрутов.
//
// Источник: Intent Registry / Intent Clusters / Intent-to-URL Mapping,
// переданные владельцем 01.08.2026.
//
// ЗАЧЕМ ВЕРДИКТ. AGENTS.md: «Сайт не имеет права представлять roadmap как
// работающие функции»; документ 29: «только реальные функции M1». Часть
// интентов из исходного реестра описывает функциональность, которой в продукте
// нет. Такие страницы не создаются — но и не забываются: они остаются здесь с
// причиной отказа, чтобы при появлении функции их можно было включить.
//
// ДВА ОСОЗНАННЫХ ОТСТУПЛЕНИЯ ОТ ИСХОДНОГО РЕЕСТРА:
//
// 1. Латинские слаги вместо кириллических canonical_url.
//    Исходный реестр задаёт адреса вида «/выбрать-дизайнера/». В
//    percent-encoding это «/%D0%B2%D1%8B%D0%B1...» — нечитаемо в шаринге,
//    аналитике и логах. Плюс на main влита локализация RU/EN/ID, а реестр не
//    отвечает, каким будет адрес английской версии. Латинские слаги
//    совместимы со всеми тремя локалями.
// 2. Иерархия вместо плоского корня.
//    Реестр кладёт все 28 адресов в корень. На сайте уже есть /designers,
//    /studios, /demo/*, /pilot, /security. Плоский корень создал бы вторую
//    параллельную информационную архитектуру рядом с существующей.
//
// Соответствие исходным ID сохранено полностью, поэтому вернуться к
// кириллическим адресам (или сделать редиректы) можно в любой момент.

export type IntentSegment = "client" | "designer" | "studio" | "partner";
export type IntentPriority = "P1" | "P2" | "P3";
export type IntentSearchType = "Informational" | "Transactional";

export interface SeoIntent {
  readonly id: string;
  /** Имя из исходного реестра — не переводить и не переписывать. */
  readonly name: string;
  readonly segment: IntentSegment;
  readonly searchType: IntentSearchType;
  readonly priority: IntentPriority;
  /** Адрес из исходного реестра — хранится для трассируемости. */
  readonly registryUrl: string;
  /** Реализованный маршрут; null — если интент не проходит проверку. */
  readonly route: string | null;
  /**
   * Проходит ли интент проверку честности: описывает ли он функциональность,
   * которая реально существует и задеплоена, либо является чисто
   * информационным материалом без обещаний продукта.
   */
  readonly honest: boolean;
  /** Для honest=false — почему. Для honest=true — на что опирается страница. */
  readonly rationale: string;
}

export const SEO_INTENTS: readonly SeoIntent[] = [
  // ─── Клиенты: информационные материалы. Продукт ничего не обещают, кроме
  //     брифа, который реально работает. ───────────────────────────────────
  {
    id: "CLIENT_001", name: "Выбрать дизайнера", segment: "client",
    searchType: "Informational", priority: "P1",
    registryUrl: "/выбрать-дизайнера/", route: "/for-clients/choosing-designer",
    honest: true,
    rationale: "Информационный материал: как оценивать дизайнера. Продуктовых обещаний нет.",
  },
  {
    id: "CLIENT_002", name: "Понять стоимость проекта", segment: "client",
    searchType: "Informational", priority: "P1",
    registryUrl: "/понять-стоимость-проекта/", route: "/for-clients/project-cost",
    honest: true,
    rationale: "Объясняет, из чего складывается цена. Опирается на реальный расчёт lib/pricing/calc.ts.",
  },
  {
    id: "CLIENT_003", name: "Узнать, что входит в дизайн-проект", segment: "client",
    searchType: "Informational", priority: "P1",
    // В исходном реестре адрес содержал запятую — механическая слагификация имени.
    registryUrl: "/узнать,-что-входит-в-дизайн-проект/", route: "/for-clients/what-is-included",
    honest: true,
    rationale: "Информационный материал. Состав КП берётся из реальных секций lib/proposal/build.ts.",
  },
  {
    id: "CLIENT_004", name: "Узнать сроки выполнения", segment: "client",
    searchType: "Informational", priority: "P1",
    registryUrl: "/узнать-сроки-выполнения/", route: "/for-clients/timelines",
    honest: true,
    rationale: "Информационный материал. Оценка срока в неделях реально считается в calc.ts.",
  },
  {
    id: "CLIENT_005", name: "Выбрать стиль интерьера", segment: "client",
    searchType: "Informational", priority: "P2",
    registryUrl: "/выбрать-стиль-интерьера/", route: "/for-clients/choosing-style",
    honest: true,
    rationale: "Чисто информационный материал, продуктовых обещаний нет.",
  },
  {
    id: "CLIENT_006", name: "Спланировать пространство", segment: "client",
    searchType: "Informational", priority: "P2",
    registryUrl: "/спланировать-пространство/", route: "/for-clients/space-planning",
    honest: true,
    rationale: "Информационный материал. Сценарные вопросы совпадают с реальными вопросами брифа.",
  },
  {
    id: "CLIENT_007", name: "Выбрать материалы", segment: "client",
    searchType: "Informational", priority: "P2",
    registryUrl: "/выбрать-материалы/", route: "/for-clients/choosing-materials",
    honest: true,
    rationale: "Чисто информационный материал. Подбора материалов в продукте нет — и страница его не обещает.",
  },
  {
    id: "CLIENT_008", name: "Согласовать решения", segment: "client",
    searchType: "Transactional", priority: "P1",
    registryUrl: "/согласовать-решения/", route: "/for-clients/approving-decisions",
    honest: true,
    rationale:
      "Транзакционный, но опирается на реально работающее: ответ клиента на публичном КП "
      + "(/p/[token], принять/обсудить/запросить правки) задеплоен в проде.",
  },
  {
    id: "CLIENT_009", name: "Избежать ошибок", segment: "client",
    searchType: "Informational", priority: "P2",
    registryUrl: "/избежать-ошибок/", route: "/for-clients/common-mistakes",
    honest: true,
    rationale: "Информационный материал. Типовые противоречия взяты из реальных правил lib/risks/rules.ts.",
  },
  {
    id: "CLIENT_010", name: "Понять процесс работы", segment: "client",
    searchType: "Informational", priority: "P1",
    registryUrl: "/понять-процесс-работы/", route: "/for-clients/how-it-works",
    honest: true,
    rationale: "Описывает реальный контур: бриф → паспорт → риски → КП.",
  },
  {
    id: "CLIENT_011", name: "Оценить качество работы", segment: "client",
    searchType: "Informational", priority: "P2",
    registryUrl: "/оценить-качество-работы/", route: "/for-clients/assessing-quality",
    honest: true,
    rationale: "Чисто информационный материал.",
  },
  {
    id: "CLIENT_012", name: "Получить консультацию", segment: "client",
    searchType: "Transactional", priority: "P3",
    registryUrl: "/получить-консультацию/", route: null,
    honest: false,
    rationale:
      "ОТКЛОНЁН: транзакционный интент под услугу, которой не существует. Консультаций "
      + "продукт не оказывает; страница вела бы к конверсии в никуда.",
  },

  // ─── Дизайнеры: всё опирается на задеплоенный контур M1. ────────────────
  {
    id: "DESIGNER_001", name: "Собрать информацию от клиента", segment: "designer",
    searchType: "Informational", priority: "P1",
    registryUrl: "/собрать-информацию-от-клиента/", route: "/guides/client-brief",
    honest: true,
    rationale: "Бриф по ссылке без регистрации работает в проде (/i/[token]).",
  },
  {
    id: "DESIGNER_002", name: "Структурировать противоречивые желания", segment: "designer",
    searchType: "Informational", priority: "P1",
    registryUrl: "/структурировать-противоречивые-желания/", route: "/guides/structuring-requirements",
    honest: true,
    rationale: "buildPassport + карточки рисков реально существуют и задеплоены.",
  },
  {
    id: "DESIGNER_003", name: "Рассчитать справедливую цену", segment: "designer",
    searchType: "Transactional", priority: "P1",
    registryUrl: "/рассчитать-справедливую-цену/", route: "/guides/pricing",
    honest: true,
    rationale: "Расчёт с прозрачной разбивкой (база × площадь × множители) работает.",
  },
  {
    id: "DESIGNER_004", name: "Подготовить коммерческое предложение", segment: "designer",
    searchType: "Transactional", priority: "P1",
    registryUrl: "/подготовить-коммерческое-предложение/", route: "/guides/proposal",
    honest: true,
    rationale: "Сборка КП и публичная страница /p/[token] задеплоены.",
  },
  {
    id: "DESIGNER_005", name: "Выявить риски до встречи", segment: "designer",
    searchType: "Informational", priority: "P1",
    registryUrl: "/выявить-риски-до-встречи/", route: "/guides/risk-detection",
    honest: true,
    rationale: "Гибрид правил и LLM с деградацией к правилам — реально работает.",
  },
  {
    id: "DESIGNER_006", name: "Управлять ожиданиями клиента", segment: "designer",
    searchType: "Informational", priority: "P1",
    registryUrl: "/управлять-ожиданиями-клиента/", route: "/guides/managing-expectations",
    honest: true,
    rationale: "Разделы «что не входит», лимит правок, условия этапов есть в proposal_defaults.",
  },
  {
    id: "DESIGNER_007", name: "Стандартизировать процесс в студии", segment: "studio",
    searchType: "Informational", priority: "P1",
    registryUrl: "/стандартизировать-процесс-в-студии/", route: "/studios/process-standards",
    honest: true,
    rationale: "Общие шаблоны КП и настройки студии реально существуют (/dashboard/setup, команда).",
  },
  {
    id: "DESIGNER_008", name: "Отследить историю решений", segment: "designer",
    searchType: "Informational", priority: "P2",
    registryUrl: "/отследить-историю-решений/", route: null,
    honest: false,
    rationale:
      "ОТКЛОНЁН: истории решений в продукте нет. risk_cards.status перезаписывается на месте, "
      + "прошлое состояние невосстановимо. Появится вместе с Decision Log.",
  },
  {
    id: "DESIGNER_009", name: "Подготовить повестку первой встречи", segment: "designer",
    searchType: "Informational", priority: "P1",
    registryUrl: "/подготовить-повестку-первой-встречи/", route: "/guides/first-meeting-agenda",
    honest: true,
    rationale: "firstMeetingQuestions() собирает повестку из принятых карточек — работает.",
  },
  {
    id: "DESIGNER_010", name: "Управлять версиями и согласованиями", segment: "designer",
    searchType: "Transactional", priority: "P2",
    registryUrl: "/управлять-версиями-и-согласованиями/", route: null,
    honest: false,
    rationale:
      "ОТКЛОНЁН: версионирования нет — proposals.version захардкожен в 1 и нигде не "
      + "инкрементируется. Транзакционная страница обещала бы несуществующую функцию.",
  },

  // ─── Студии ────────────────────────────────────────────────────────────
  {
    id: "STUDIO_001", name: "Управлять командой проектов", segment: "studio",
    searchType: "Informational", priority: "P1",
    registryUrl: "/управлять-командой-проектов/", route: "/studios/team-projects",
    honest: true,
    rationale: "Команда студии и общий список проектов задеплоены (studio_members, /dashboard).",
  },
  {
    id: "STUDIO_002", name: "Анализировать метрики продаж", segment: "studio",
    searchType: "Informational", priority: "P2",
    registryUrl: "/анализировать-метрики-продаж/", route: "/studios/sales-metrics",
    honest: true,
    rationale: "Воронка на /dashboard/analytics реально считается из таблицы events.",
  },
  {
    id: "STUDIO_003", name: "Настроить правила ценообразования", segment: "studio",
    searchType: "Transactional", priority: "P1",
    registryUrl: "/настроить-правила-ценообразования/", route: "/studios/pricing-rules",
    honest: true,
    rationale: "Мастер ставок и множителей на /dashboard/setup существует.",
  },
  {
    id: "STUDIO_004", name: "Интегрировать с другими инструментами", segment: "studio",
    searchType: "Transactional", priority: "P3",
    registryUrl: "/интегрировать-с-другими-инструментами/", route: null,
    honest: false,
    rationale:
      "ОТКЛОНЁН: внешние интеграции — явный guardrail «не строить». Ни одной интеграции "
      + "не существует; транзакционная страница продавала бы отсутствующий продукт.",
  },

  // ─── Партнёры: территория M4, не построена. ─────────────────────────────
  {
    id: "PARTNER_001", name: "Получить информацию о проекте", segment: "partner",
    searchType: "Informational", priority: "P2",
    registryUrl: "/получить-информацию-о-проекте/", route: null,
    honest: false,
    rationale:
      "ОТКЛОНЁН: партнёрский доступ — M4. В проде есть только Project Room с токенами "
      + "участников (M3); полноценного партнёрского контура нет, страница переобещала бы.",
  },
  {
    id: "PARTNER_002", name: "Отслеживать изменения проекта", segment: "partner",
    searchType: "Informational", priority: "P2",
    registryUrl: "/отслеживать-изменения-проекта/", route: null,
    honest: false,
    rationale:
      "ОТКЛОНЁН: отслеживания изменений для партнёров нет. ChangeRequest/ImpactAssessment "
      + "относятся к M4 и не задеплоены.",
  },
];

/** Интенты, по которым созданы страницы. */
export const PUBLISHED_INTENTS = SEO_INTENTS.filter(
  (intent): intent is SeoIntent & { route: string } => intent.honest && intent.route !== null,
);

/** Отклонённые — с причиной. Сохраняются намеренно, а не удаляются. */
export const REJECTED_INTENTS = SEO_INTENTS.filter((intent) => !intent.honest);

export function intentByRoute(route: string): SeoIntent | undefined {
  return SEO_INTENTS.find((intent) => intent.route === route);
}
