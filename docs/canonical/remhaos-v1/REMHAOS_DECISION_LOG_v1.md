> Brand-only successor of the corresponding ARCHIDOM document. Product scope and architecture are unchanged except where a later approved addendum explicitly says otherwise.
> Current public brand: RemHaOS. Russian pronunciation: РемХаос. Primary host: https://remhaos.com.

# REMHAOS — PRODUCT & ARCHITECTURE DECISION LOG v1

**Дата freeze:** 27.07.2026  
**Правило:** решение не переоткрывается без новых фактов и OWNER DECISION или утверждённого Addendum.

| ID | Решение | Статус | Основание | Последствие |
|---|---|---|---|---|
| DEC-001 | Module 5 не создаётся | LOCKED | Charter v0.5 §5 | Studio Intelligence остаётся shared layer/package |
| DEC-002 | Одна Project Memory для M1–M4 | LOCKED | Charter §5, Architecture | Нет отдельных правд модулей |
| DEC-003 | Studio Intelligence не доменный модуль | LOCKED | Addendum A1 | Только коммерческая упаковка/settings |
| DEC-004 | ProjectFact — надтип | LOCKED | A1 §3 | fact_type: requirement/constraint/assumption/open_question |
| DEC-005 | ProposedChange удалён | LOCKED | Charter Change Control | Используются ChangeRequest и ChangeOrder |
| DEC-006 | MCP — адаптер | LOCKED | Architecture | Integration Gateway не зависит от MCP |
| DEC-007 | Workflow Engine раньше Builder | LOCKED | Architecture | Sprint 1 фиксированные templates |
| DEC-008 | AI не изменяет approved truth молча | LOCKED | Charter safety | Proposed outputs + human gate + version |
| DEC-009 | AI cost измеряется с Sprint 1 | LOCKED | A1 §2 | ai_calls обязателен, billing позже |
| DEC-010 | Self approval явно маркируется | LOCKED | A1 §6.2 | Не выдавать за independent review |
| DEC-011 | StudioStandard версионируется | LOCKED | A1 §6.1 | standard_drift event, no silent rewrite |
| DEC-012 | Публичные роли: Заказчик, Дизайнер, Архитектор, ГлавПрораб | LOCKED | Charter | `site_manager` только technical id |
| DEC-013 | `* Intelligence` только внутренние названия | LOCKED | A1 §4 | Не использовать на сайте/UI |
| DEC-014 | Integration order не является разрешением | LOCKED | A1 §5 | PII-heavy integrations blocked by 152-ФЗ gate |
| DEC-015 | Sprint 1 не закрывает полный Pilot Slice | LOCKED | Charter §14 | Отчёт показывает N/10 |
| DEC-016 | Процентные readiness scores отменены | LOCKED | A1 §7.4 | Использовать status + evidence level |
| DEC-017 | Новые документы не называются Source of Truth | LOCKED | Charter hierarchy | Классы документов фиксированы |
| DEC-018 | Architecture freeze после Canonical Package | LOCKED | Owner command | Изменения через Addendum/Decision Log |
| DEC-019 | Публичный бренд RemHaOS; основной домен `remhaos.com` | LOCKED | OWNER DECISION 28.07.2026 / Addendum A3 | Актуальные UI, docs, metadata и public URLs используют RemHaOS; архитектура не меняется |
| DEC-020 | Brand positioning: `RemHaOS — операционная система полного цикла ремонта: от первого брифа до финальной приёмки` | LOCKED | OWNER DECISION 30.07.2026 | Это публичное позиционирование и категория продукта; Sprint 1 implementation scope не расширяется за пределы Platform Foundation + M1 |
| DEC-021 | M2 открыт; собственный геометрический редактор в scope; ниша — доказуемая история решений, не паритет с CAD; обмен: чтение DWG серверно как подложка, запись DXF, без платных лицензий | LOCKED | OWNER DECISION 08.08.2026 / Addendum A4 | Charter §16 правится по A4 §1.1 (оба бренда); матрица M2 → Build per A4, P1; WF-M2-001 → AUTHORIZED BY A4; значения с подложки неподтверждённые до явного подтверждения (A4 §3.3) |
| DEC-022 | Канонизация подписи версий заморожена: кодовые точки, локалезависимые сравнения запрещены | LOCKED | ADR-001 (+ независимый ADR-0007: паритет с C-collation PostgreSQL) | Изменение канонизации — только новым ADR; контрольный хеш закреплён тестом canonical-signature.test.ts |
| DEC-023 | Позиционирование v2: категория — система записи истины ремонта; формула DEC-020 не меняется; публичное имя редактора «Планировки», слово «CAD» наружу не используется; платит студия за рабочее пространство, клиент бесплатно, без платы за места и экспорт | LOCKED | OWNER DECISION 08.08.2026 / `docs/brand/REMHAOS_POSITIONING_v2_2026-08-08.md` | Критерии сдачи M2 дополнены разделом §8 (шесть условий: цена решения, человеческая формулировка подписи, DXF-экспорт, клиентская витрина, продуктовый язык интерфейса, демо-сценарий); столп публикуется только когда его код сдан; публичные имена модулей «Бриф и КП» · «Планировки» · «Документация» · «Стройка и приёмка»; чат-мост (§5.1) — после порта и сдачи M2, отдельным решением |
