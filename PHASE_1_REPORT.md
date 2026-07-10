# PHASE 1 / MODULE 1 — Final QA Report

Дата: 2026-07-10.

Статус: **M1 engineering-ready для пилотной проверки** в границах pre-sale контура:

**Brief -> Passport -> Risks -> Review Board -> Pricing -> Proposal**.

Важно: текущая рабочая копия содержит незакоммиченные изменения будущих контуров `project-room` / `concept-pack`. Они не входят в M1 и не были частью QA-вывода M1. M1-проверки ниже прогнаны на текущей рабочей копии и проходят.

## Что входит в готовый M1

- Создание pre-sale проекта дизайнером и публичной intake-ссылки `/i/[token]`.
- Public brief без регистрации клиента, с ветвлением и локальным draft autosave.
- Сохранение `answers`, загрузка файлов как metadata-only, без анализа изображений.
- Детерминированный `buildPassport(answers)` без LLM-вызова.
- Risk pipeline: deterministic rules + один LLM-pass через provider abstraction + fallback к rule cards.
- Review Board: паспорт, ответы, файлы, risk cards, accept/reject и редактирование risk card текстов.
- Pricing: deterministic `calcPrice()` с прозрачными factors.
- Deterministic Package Recommendation:
  - `derivePackageRecommendation(...)`;
  - fallback вместо `null`;
  - reason codes / confidence / included service items / pricing explanation;
  - accepted risks могут усиливать recommendation;
  - rejected risks не усиливают публичное КП.
- Proposal:
  - детерминированная сборка секций;
  - редактируемые секции;
  - отдельная секция рекомендованного формата работы;
  - price section объясняет выбранный формат;
  - accepted `proposal_implication` попадает в КП;
  - public proposal link `/p/[public_token]`;
  - printable HTML вместо PDF-библиотеки.

## Автоматические проверки

Прогнано на текущей рабочей копии:

```bash
npm run test
npm run typecheck
npm run lint
npm run build
```

Результат:

- `npm run test` — зелёный, 15 test files / 74 tests.
- `npm run typecheck` — зелёный.
- `npm run lint` — зелёный.
- `npm run build` — зелёный, production build собран.

## Ручной QA сценарий M1

Так как локального `.env` с Supabase/YandexGPT ключами в репозитории нет, браузерный DB-backed проход `/dashboard -> /i/[token] -> /p/[token]` не выполнялся как полноценная ручная сессия. Вместо этого проведён сценарный QA на тех же доменных функциях, которые использует M1 runtime:

1. Сформирован валидный бриф сложного проекта:
   - квартира 72 м²;
   - для себя надолго;
   - высокий утренний сценарий, один санузел;
   - heavy cooking;
   - высокая нагрузка на хранение;
   - бюджет с мебелью;
   - urgent timeline;
   - минимализм, натуральный камень, мебель на заказ;
   - комплектация/закупки и удалённые согласования;
   - балкон как технически чувствительное решение.
2. `buildPassport(answers)` собрал shadow passport.
3. `evaluateRules(passport, answers)` сгенерировал rule risk cards.
4. Risk cards вручную разложены на accepted/rejected.
5. Один accepted risk был отредактирован через `proposal_implication`.
6. `derivePackageRecommendation(...)` построила пакет и объяснение.
7. `calcPrice(...)` рассчитал price factors.
8. `buildProposalSections(...)` собрал КП.
9. Отдельно проверен fallback для недостаточных данных.
10. Отдельно проверено, что rejected technical risk не усиливает recommendation.

Фактический результат сценария:

```json
{
  "passportPackage": "full_plus_supervision",
  "ruleCards": {
    "count": 6,
    "types": ["budget", "timeline", "function", "function", "budget", "technical"]
  },
  "reviewBoardStatuses": {
    "accepted": 2,
    "rejected": 4
  },
  "recommendation": {
    "key": "full_plus_supervision",
    "label": "Полный дизайн-проект + сопровождение",
    "confidence": "high",
    "reasonCodes": [
      "tight_budget",
      "multiple_zones",
      "working_docs_needed",
      "furniture_or_equipment_scope",
      "urgent_timeline",
      "custom_or_complex_scope",
      "implementation_sensitive"
    ]
  },
  "proposal": {
    "sectionIds": [
      "task",
      "package",
      "works",
      "stages",
      "price",
      "included",
      "excluded",
      "revisions",
      "client_inputs",
      "stage_completion"
    ],
    "packageSectionHasLabel": true,
    "priceExplainsRecommendation": true,
    "includedUsesEditedRiskText": true
  },
  "fallback": {
    "package": "concept",
    "recommendation": "concept",
    "confidence": "low"
  },
  "rejectedRiskIgnored": {
    "package": "full",
    "hasTechnicalReason": false
  }
}
```

QA conclusion:

- `scope.package` больше не остаётся `null` в проверенных сценариях.
- Рекомендация пакета детерминированная.
- КП использует recommendation.
- Pricing explanation объясняет выбранный формат.
- Accepted edited risk попадает в КП.
- Rejected risk не усиливает публичное КП.
- Новых LLM calls для package recommendation нет.

## Известные ограничения M1

- Полный browser QA с реальной Supabase-сессией требует заполненный `.env`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `YC_FOLDER_ID`, `YC_API_KEY`.
- Без реальных Yandex/GigaChat ключей LLM-risk layer штатно деградирует к rule cards.
- Proposal versioning всё ещё минимальное: схема поддерживает `version`, но продуктовый workflow version 2 не закрыт.
- PassportFact / explainability rows не выделены как отдельная структура; паспорт читается как агрегированный объект.
- Brief сейчас шире исходных “10 вопросов” из MVP-описания; для пилота нужно следить за конверсией quick/deep.
- Project Room и Concept Pack в текущей рабочей копии относятся к будущим модулям и не должны считаться частью M1 acceptance.

## Что требуется от пользователя для пилота

- Дать реальные Supabase/Yandex env для browser QA и демо-сценария.
- Принять или отложить незакоммиченные Module 2/3 изменения, чтобы M1 baseline был чистым.
- Подтвердить 2-3 пилотных дизайнеров для WTP-интервью.
- Подтвердить SMTP/домен отправки, если КП и ссылки будут отправляться письмом, а не вручную.

## Решение по фазе

M1 можно считать готовым к **пилотной продуктовой проверке**, но не к масштабированию.

Следующий корректный шаг — не расширять код в Module 2/3, а пройти:

- **WTP-интервью**: проверка готовности дизайнеров платить за pre-sale контур.
- **SMTP/доставка**: проверка, что ссылки на бриф и КП стабильно доходят клиентам.
- **Ручной browser QA на реальном env**: один проект от создания до отправленного КП.
