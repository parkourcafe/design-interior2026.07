# WP-K2 — поправки документов — EVIDENCE

[ИЗВЛЕЧЕНО] 2026-09-09; branch wp/wp-k2-k-list-corrections-runbook;
baseline `1e132cb47bc9893ac1d46c46051898cf1df0eb70` (текущий `origin/main`).
Рабочий diff без коммита; финальный commit SHA и CI run IDs появятся только после
отдельно разрешённых commit/push/PR действий. CONTEXT_MODE repository_only,
разрешён владельцем.

## Основание и disposition

| Строка | Результат | Основание |
|---|---|---|
| [ИЗВЛЕЧЕНО] К-1 | append исторического аудита: Platform CODE_PRESENT после 23.08 | migrations 20260824130000–160000, action-registry.ts; DEC-038 |
| [ИЗВЛЕЧЕНО] К-2 | runbook различает disposable activation и production adoption | DEC-038; подпись DEC-040/Р19/Р20 UNKNOWN |
| [ИЗВЛЕЧЕНО] К-3 | append: #121 MERGED 30.08 | gh pr view 121: cfe1caae80a0e6c45c0921f044b556e8b8fdb4a2,2026-08-30T06:16:48Z |
| [ИЗВЛЕЧЕНО] К-4 | append CSV row:90 entries / 90 matching hashes | tests/ap1/environment/migration-ledger.sha256; исторические 24 не переписаны |
| [ИЗВЛЕЧЕНО] К-5 | baseline уже содержит ДВЕ двери, no-op для числа; ссылки сохранены | DEC-034/037 и runbook §0/§2 |
| [ИЗВЛЕЧЕНО] К-7 | UNRESOLVED_OWNER_DECISION | строка нового conflict register, не принятие риска |
| [ИЗВЛЕЧЕНО] К-8 | UNRESOLVED_CONTEXT_RECONCILIATION | строка нового conflict register, не выдуманное отсутствие/наличие authority |
| [ИЗВЛЕЧЕНО] К-12 | explanatory banners в 3 исторических файлах | Charter v0.5 §4, legacy numbering не role-M2/M3 |

[ИЗВЛЕЧЕНО] Р19/Р20 описаны в runbook условно: отдельные module switches,
их DB-state проверки, V1 switch, отдельный smoke-project и rollback.
Открытие/подпись/production операции не выполнялись и не утверждаются.

## Allowlist по факту

[ИЗВЛЕЧЕНО] Только 9 разрешённых docs:
docs/audits/REMHAOS_FINAL_AUDIT_2026-08-23.md;
docs/audits/REMHAOS_AUTONOMOUS_STAGING_ACCEPTANCE_2026-08-29.md;
REMHAOS_FEATURE_READINESS_MATRIX_2026-08-02.csv;
M4_V1_PRODUCTION_RUNBOOK.md;
MODULE_3_REPORT.md;
MODULE_2_CONCEPT_PACK_REPORT.md;
RELEASE_CONTROL.md;
docs/audits/REMHAOS_CONFLICT_REGISTER_2026-09-xx.csv;
docs/audits/wp/WP-K2_EVIDENCE.md.

[ИЗВЛЕЧЕНО] Root paths разрешены точно; подписанные canonical файлы только
прочитаны, не изменены. Два исторических аудита и readiness CSV — append-only.
Баннеры добавлены после заголовка, исходные тела сохранены.

## Хотспоты / пины / миграция

[ИЗВЛЕЧЕНО] Нет. H9/H10, runtime, SQL, AGENTS/configs/skills не менялись.
Canonical REMHAOS_READINESS_MATRIX_v1.csv не входит в allowlist: его состояние
не объявляется исправленным этим пакетом.

## Проверки

[ИЗВЛЕЧЕНО] SHA-256 всех 90 ledger entries проверены по файлам baseline, 90/90.
Это repository proof, не новый PG/hosted/production replay.
[ИЗВЛЕЧЕНО] Python csv.reader: readiness CSV — 10 data rows × 4 columns;
conflict register — 2 data rows × 7 columns, обе таблицы валидны.
14 локальных markdown links существуют. Prefix двух исторических аудитов
и readiness CSV побайтово сохранён; тела трёх banner-файлов сохранены.
`git diff --check` — exit 0. Ровно 9 файлов, все в allowlist.
[ИЗВЛЕЧЕНО] На свежем baseline выполнен `NPM_CONFIG_CACHE=/private/tmp/npm-cache-
remhaos-20260909 npm ci && npm run release:check`: exit 0; lint 0 errors/13
existing warnings, typecheck pass, 196 test files / 1583 pass / 10 skipped,
build pass. Это локальный proof; CI/hosted не запускались.

## Не сделано / blind review

[ИЗВЛЕЧЕНО] Production state и секреты не читались; Р19/Р20/DEC-040 не
подписывались; К-7/К-8 не решены за владельца. Коммит/push/PR не выполнялись.
[ИЗВЛЕЧЕНО] Независимое read-only review: REVIEW_PASSED. Коммит/push/PR
по-прежнему не выполнялись; финальный commit SHA и CI run IDs будут добавлены
после соответствующего owner-разрешения.
