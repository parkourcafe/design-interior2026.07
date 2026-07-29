> SUPERSEDED_BY_BRAND_RENAME_2026-07-28. CURRENT_BRAND: RemhaOS. Successor package: docs/canonical/remhaos-v1/. Historical content preserved for provenance.

# ARCHIDOM — PRODUCT & ARCHITECTURE DECISION LOG v1

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
