# Project Intelligence — Architecture v1

Статус: **Architecture v1 accepted для application-level L1**, 16 июля 2026 года. Этот
каталог фиксирует целевую архитектуру и порядок перехода от текущего ArchiDom M1 к общему
ядру ArchiDom Space / ProUp. Durable persistence, API/UI wiring и production остаются за
отдельным database/baseline gate.

## Принятое решение

- Одна кодовая база и одно доменное ядро.
- Две продуктовые редакции: `studio` и `renovation`.
- Два физически раздельных региональных контура: `us` и `ru`.
- На первом этапе — модульный монолит, а не микросервисы.
- Первый технический результат — сквозной путь `Source → Claim → Decision → Version → Change Impact → Export`.
- Полный ArchiDom и полный ProUp одновременно не строятся. После общего вертикального среза выбирается один коммерческий build-track по платным пилотам.

## Документы

1. [architecture-v1.md](./architecture-v1.md) — принятая слоистая application-архитектура, security boundaries и gates.
2. [vertical-slice-l1-spec.md](./vertical-slice-l1-spec.md) — исполняемое ТЗ первого application-level среза.
3. [architecture-v0.1.md](./architecture-v0.1.md) — исторический baseline, сохранённый для traceability.
4. [project-graph.md](./project-graph.md) — каноническая модель Project Graph, provenance, версии и change-impact.
5. [vertical-slice-spec.md](./vertical-slice-spec.md) — product-level сквозной сценарий и критерии приёмки.
6. [domain/contract-v0.1.md](./domain/contract-v0.1.md) — frozen pure-domain contract.
7. [vertical-slice/](./vertical-slice/) — принятые use-case/API/events/UI contracts и fixtures mapping.
8. [multi-agent/wave-2/](./multi-agent/wave-2/) — три непересекающихся ТЗ Wave 2 и Integrator protocol.
9. [technical-audit-2026-07-16.md](./technical-audit-2026-07-16.md) — что уже существует, что переиспользовать и чего не хватает.
10. [codex-execution-spec.md](./codex-execution-spec.md) — исходный execution backlog и зависимости.
11. [backlog.md](./backlog.md) — последовательность работ и гейты.
12. [verification-2026-07-16.md](./verification-2026-07-16.md) — воспроизводимые результаты тестов и ограничения проверки.
13. [production-schema-observation-2026-07-16.md](./production-schema-observation-2026-07-16.md) — read-only снимок доступной production Data API schema.
14. [pilot-pack.md](./pilot-pack.md) — готовый пакет для интервью и concierge pilots.
15. [measurement-plan.md](./measurement-plan.md) — события, формулы метрик и decision gate.
16. [adr/](./adr/) — принятые архитектурные решения.
17. [agent-runs/INTEGRATION_REPORT.md](./agent-runs/INTEGRATION_REPORT.md) — принятые результаты Wave 1 и блокирующие database gates.
18. [agent-runs/wave-2/INTEGRATION_REPORT.md](./agent-runs/wave-2/INTEGRATION_REPORT.md) — финальная приёмка Architecture v1 и application-level L1.
19. [agent-runs/db-wave/README.md](./agent-runs/db-wave/README.md) — materialized Git/migration gate перед DB1/DB2.

## Порядок исполнения

```text
Architecture baseline
  → доменные контракты и инварианты
  → L1 application orchestration
  → root end-to-end contract test
  → Git/migration integrity gate
  → database design review
  → additive migrations
  → ingestion + provenance
  → versioned Project Graph
  → deterministic change-impact
  → handoff export
  → первый коммерческий build-track
```

## Что сознательно не выполняется автоматически

- платные пилоты и интервью;
- выбор первого коммерческого трека без рыночных данных;
- применение миграций к production Supabase;
- перенос production-данных между регионами;
- изменение текущего публичного workflow до появления совместимой миграции и regression suite.

Все остальные подготовительные результаты должны быть воспроизводимы из этого пакета без устных пояснений.
