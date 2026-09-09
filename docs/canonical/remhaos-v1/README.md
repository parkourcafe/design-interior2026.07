> Brand-only successor of the corresponding ARCHIDOM document. Product scope and architecture are unchanged except where a later approved addendum explicitly says otherwise.
> Current public brand: RemHaOS. Russian pronunciation: РемХаос. Primary host: https://remhaos.com.

# REMHAOS CANONICAL PACKAGE V1.0

Дата freeze: 27.07.2026

## Product Contract
- REMHAOS_CHARTER_v0.5_CANONICAL.md

## Technical Architecture
- REMHAOS_PLATFORM_ARCHITECTURE_v1.1.md
- REMHAOS_ENTITY_CATALOG_v1.md
- REMHAOS_GLOSSARY_v1.md
- REMHAOS_WORKFLOW_CATALOG_v1.md
- REMHAOS_DECISION_LOG_v1.md

## Execution
- REMHAOS_EXECUTION_BRIEF_SPRINT_1.md
- REMHAOS_READINESS_MATRIX_v1.csv
- REMHAOS_READINESS_UPDATE_v1.md — **в этой папке отсутствует**: при ребрендинге
  файл не переносился, существует только предшественник
  `../archidom-v1/ARCHIDOM_READINESS_UPDATE_v1.md`

## Clarifications
Уточнения к подписанным аддендумам. Подписанный аддендум не переписывается; при конфликте действует уточнение.
- REMHAOS_A5_CLARIFICATION_M3_ROUTES_2026-08-11.md — DEC-028, маршруты встроенного модуля M3
- REMHAOS_A6_CLARIFICATION_M4_GRANT_MECHANISM_2026-08-11.md — DEC-029, механизм выдачи прав инкремента 1 модуля M4
- REMHAOS_A6_CLARIFICATION_M4_EXECUTION_LAYER_2026-08-12.md — DEC-032, целевой человеческий контракт M4 из десяти команд; V1–V3 NOT AUTHORIZED до отдельного M4 IMPLEMENTATION GO

## Governance
После freeze изменения продукта идут через утверждённый Addendum и Decision Log. После спринта создаются Implementation Report и Readiness Update. Новая независимая «финальная архитектура» не создаётся.

## Audits and plans (not canonical)
Аудиты и планы не являются источником истины; при конфликте действует журнал решений.
- `../../audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md` — глобальный аудит продукта и инфраструктуры на `cfe1caa`
- `../../audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md` — действующий план завершения M1–M4 и запуска (заменяет план 23.08)
- `../../execution/REMHAOS_MASTER_TZ_2026-09-08.md` — генеральное ТЗ программы (оркестратор, пакеты работ, волны); доска — `../../execution/STATUS.md`
- `../../execution/HANDOFF_TO_CODEX_2026-09-09.md` — актуальный хендофф для продолжения работы в Codex (сменил Claude Code Remote как механизм исполнения)
