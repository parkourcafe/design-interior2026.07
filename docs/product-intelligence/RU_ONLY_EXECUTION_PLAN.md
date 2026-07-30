# RU-only execution plan

Дата: 16 июля 2026 года
Scope: ProUp Renovation / RU deployment cell only

## Порядок работ

1. Заморозить RU-контракт: cell, русский интерфейс, рубли, Project Graph, версии,
   provenance, approvals и change-impact.
2. Собрать RU vertical slice: импорт пакета, baseline, комплектность, WBS, смета,
   закупки, замены, change order, фотоотчёт, приёмка и handover.
3. Подключить только подтверждённые RU-адаптеры: PDF/XLSX/изображения и
   Telegram-friendly отчёты.
4. Повторно проверить PG16/PG17, RLS, concurrency, idempotency и rollback.
5. Подготовить production gate: ledger-only adoption plan, backup/rollback runbook
   и явное подтверждение перед production.

US/Studio Edition, multi-region runtime, 3D/ERP/marketplace и production SQL без
отдельного разрешения в этой фазе не делаем.

Критерий перехода: зелёный harness и два живых RU-проекта, повторно запущенных одной
компанией.
