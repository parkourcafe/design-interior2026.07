# ArchiDom RU — Local Clone Rehearsal and Adoption Decision

Дата: 20 июля 2026 года.  
Контур: disposable local Supabase / PostgreSQL 17 и plain PostgreSQL 16/17.  
Production: только read-only snapshot; изменений не было.

## Решение

```text
LOCAL_IMPLEMENTATION=PASS
LOCAL_DB2_DB5_PG16=PASS
LOCAL_DB2_DB5_PG17=PASS
LOCAL_SUPABASE_PG17_REPLAY=PASS
AUTHENTICATED_PILOT_GATE=PASS
AUTHENTICATED_BROWSER_QA=PASS
REMEDIATION_PARTIAL_REHEARSAL=PASS
EXACT_PRODUCTION_RESTORE=NOT_PROVEN
PRODUCTION_CHANGED=false
PRODUCTION_ADOPTION=NO-GO
```

`NO-GO` не означает дефект M1–M4. Локальная реализация и полный поддерживаемый
Kora vertical slice воспроизводимы. Production adoption запрещён из-за
незакрытых различий baseline, непроверенной безопасной замены legacy
`is_studio_member`, hosted Auth/Storage/backup controls и отсутствия финального
release/sign-off gate.

## Зафиксированный runtime

| Компонент | Версия / образ |
|---|---|
| Supabase CLI | `2.109.1` |
| Docker client / server | `29.5.2` / `29.2.1` |
| Colima | `0.10.1`, isolated profile `archidom-ap1` |
| Local Postgres | `public.ecr.aws/supabase/postgres:17.6.1.143` |
| Matrix Postgres | `postgres:16-alpine`, `postgres:17-alpine` |
| GoTrue | `v2.192.0` |
| PostgREST | `v14.14` |
| Storage | `v1.62.5` |
| Kong | `2.8.1` |
| Production snapshot | PostgreSQL `17.6.1.141`, project `design2026` |

Local Supabase использовал loopback ports `59620–59629` и Data API allow-list
из пяти public/API schemas. Private persistence schemas через PostgREST не
экспонировались.

## Migration и restart proof

- Все 14 timestamped migrations применены в исходном порядке; существующие
  migrations не редактировались.
- Чистый `db reset` повторно применил тот же exact ledger.
- Supabase stop/start сохранил ledger; request-bound read/replay после рестарта
  прошёл.
- PG16 и PG17 harness с нуля прошёл DB2–DB5, schema/security negatives,
  authenticated reads, 32 concurrent operations, exact M4 replay и database
  restart replay.
- Runtime grants к private persistence tables отсутствуют; executor roles имеют
  `NOLOGIN`/`NOINHERIT`; `client-uploads` остаётся private.

## Authenticated Pilot Gate

Созданы пять отдельных local Auth users/sessions: owner, architect, builder,
client и guest. Sanitized Kora fixture (1 800 м², registry 209) загружен через
разрешённые Auth, Storage и command contracts. Service role применялся только
test orchestrator для disposable user provisioning/worker action и отсутствовал
в application runtime; human operations выполнялись user JWT.

Пройдены invitation, sources/read portfolio, human reviews, distribution и
acknowledgement, change/impact review, photo evidence/review, milestone
acceptance, guest exact-token access, CSRF, role/tenant negatives,
idempotency/replay и workspace render. Полный terminal marker:

```text
AP1_SUPPORTED_SLICE_E2E_OK users=5 auth=magiclink kora_registry=209 foundation_fixtures=4 site_photos=1 area_m2=1800 invite_accept=true distribution_ack=true change_impact=true photo_review=true milestone_accept=true replay=true csrf=true isolation=true seeded_preconditions=true production_changed=false
```

## Browser QA и evidence hygiene

Real local Supabase Auth cookies были импортированы в отдельные headless Chrome
profiles. Owner, architect, builder и client проверены на desktop; owner также
на viewport 390×844. Protected workspace сохранил authenticated state, показал
Kora Food Hall / 1 800 м², console errors отсутствовали.

```text
AP1_AUTHENTICATED_BROWSER_QA_OK roles=4 desktop=4 mobile=1 console_errors=0
```

PNG и JSON/HTML evidence находятся вне repository в
`/private/tmp/projectceo-ap1-evidence`. Cookie/token-файлы удалены; текстовый
scan не обнаружил secrets, absolute user paths, production filenames или
Kora source manifest. Evidence является disposable local proof, не production
artifact.

## Remediation rehearsal и rollback

На local PG17 отдельно проверены:

- четыре FK indexes (`events_project_id`, `project_participants_auth_user_id`,
  `project_task_events_task_id`, `project_tasks_assignee_participant_id`) —
  ready/valid, затем точно удалены rollback;
- `rate_limits` — anon/authenticated grants отозваны, добавлена
  service-role-only policy, negative access пройден; rollback восстановил
  production snapshot grants и отсутствие policy;
- 19 legacy policies временно переписаны с `auth.uid()` на
  `(select auth.uid())`; legacy owner/cross-owner/architect smoke пройден;
  rollback восстановил исходные expressions;
- five-role Kora E2E повторно прошёл на index/`rate_limits` candidate.

`is_studio_member` намеренно не был просто закрыт: 13 legacy policies напрямую
зависят от его `EXECUTE`. Безопасная additive replacement function/policy bridge
ещё не реализована и не доказана. Leaked-password protection является hosted
Supabase Auth setting и локальным SQL не закрывается.

## Clone ↔ production snapshot

| Область | Production snapshot | Local replay clone | Вывод |
|---|---|---|---|
| Migration ledger | пустой | 14 rows exact | требуется отдельно одобренный ledger repair/adoption plan |
| ProjectCEO schemas | отсутствуют | присутствуют | ожидаемый additive change, ещё не production evidence |
| `rate_limits` | legacy table, broad grants, no policy | отсутствует в authoritative migrations; проверялся overlay | baseline drift не воспроизводится одним migration chain |
| Data API schemas | custom exposure не доказан | exact allow-list 5 | production setting gate открыт |
| Auth | leaked-password protection disabled | local magic-link PASS | hosted control открыт |
| Storage | private bucket, production policy/recovery не доказаны | local upload/read/deny PASS | backup/restore и production policy gate открыты |
| Advisors | legacy findings сохранены | candidates частично проверены | `is_studio_member` и hosted Auth finding открыты |
| Data | production row counts snapshot only | sanitized Kora fixture | это migration replay clone, не provider backup restore |

## Условия пересмотра NO-GO

1. Одобрить и отрепетировать production baseline/ledger repair без повторного
   выполнения legacy DDL; включить `rate_limits` drift в authoritative plan.
2. Реализовать additive compatibility bridge для `is_studio_member`, заменить
   зависимые policies, пройти RLS/tenancy/five-role regression и rollback.
3. Включить leaked-password protection и проверить SMTP, redirects, OTP/magic
   link, callback и expiry в hosted disposable environment.
4. Выполнить provider-equivalent backup/restore, включая Storage inventory,
   orphan reconciliation и измеренные RTO/RPO.
5. Зафиксировать production Data API allow-list, Auth/Storage settings, advisors,
   monitoring, kill switch, final artifact hash и человеческие sign-offs.
6. После нового read-only snapshot повторить diff; неизвестный drift означает
   stop. Только после этого выпускать новый GO / GO WITH CONDITIONS / NO-GO.

