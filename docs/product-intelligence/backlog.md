# Backlog и гейты

| ID | Задача | Зависит от | Можно автономно сейчас | Гейт |
|---|---|---|---|---|
| PI-001 | Материализовать repo и защитить локальный HEAD | — | частично; iCloud не отдал файлы | clean git status |
| PI-002 | Сверить migrations с production schema | PI-001 | нет production schema access | schema audit |
| PI-010 | Pure graph contracts/invariants/impact | — | да, начато | unit tests |
| PI-011 | Organization ownership migration | PI-002 | design да, apply нет | RLS tests |
| PI-012 | Развести workspace и physical Area | PI-002, PI-011 | design да | compatibility test |
| PI-020 | Sources/fragments schema | PI-011, PI-012 | design да | migration review |
| PI-021 | Ingestion dual-write | PI-020 | после baseline | intake regression |
| PI-030 | Graph persistence | PI-011, PI-020 | после baseline | DB constraints/RLS |
| PI-031 | Passport projection | PI-030 | после graph persistence | golden parity |
| PI-032 | Source-linked review UI | PI-030 | после graph persistence | usability check |
| PI-040 | Project versions/change sets | PI-030 | после revision contract | immutable V1/V2 |
| PI-041 | Persisted impact | PI-010, PI-040 | pure часть сейчас | deterministic paths |
| PI-050 | Versioned handoff export | PI-032, PI-041 | spec сейчас | pilot export |
| GTM-US | 10 interviews + 3 paid pilots | pilot materials | требует людей | paid evidence |
| GTM-RU | 10 discovery + 3 design packages | pilot materials | требует людей | live packages |
| DEC-001 | Выбрать первый build-track | GTM-US, GTM-RU | нет | оплаченный повтор |

## 30-day decision rule

Полноценный edition получает build priority только при наличии:

- оплаченного или договорённого concierge pilot;
- реальных проектных документов;
- измеримого результата первого проекта;
- намерения запустить второй живой проект.

Если ни один трек не проходит гейт, продолжается только общий vertical slice и concierge work; scope редакций не расширяется.
