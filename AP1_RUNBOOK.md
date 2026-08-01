# AP1 Runbook — authenticated pilot в disposable-окружении

**Основание:** `AGENTS.md` («Закрыть Authenticated Pilot Gate в disposable Supabase, не в production») и `docs/product-intelligence/wave-3/MASTER_EXECUTION_PLAN.md` §4 (ворота AP1/AP2/AP3).

**Статус на 01.08.2026:** окружение создано, миграции не применены.

---

## 0. Контекст, который нельзя потерять

Обнаружено 01.08.2026 при первом прямом доступе к Supabase: **production и этот репозиторий — разные архитектурные линии.**

- В проде (`design2026` / `ztnycrchwxqczqbyegnp`) нет ни одной схемы `projectceo_*` или `project_intelligence`.
- Журнал миграций прода — 13 записей, ни одной из них нет в репозитории (`platform_foundation_m1`, `govern_proposal_revisions_and_workflow_commands`, `complete_m1_governed_runtime` и др.).
- Прод живёт собственным «governed M1 runtime»: `workflow_runs`, `approval_requests`, `project_facts`, `ai_calls`, `proposal_revisions`, плюс колонка `proposals.issued_revision_id`, которой нет в схеме репозитория.
- В проде реальные данные: 8 дизайнеров, 27 проектов, 86 ответов, 53 события.

**Решение владельца (вариант 3):** прод остаётся текущим продуктом для клиентов; ProjectCEO/AP1 проверяется в отдельном disposable-окружении; судьба репозитория и миграции решается отдельно после пилота.

Практическое следствие: **AP3-команды репозитория (`create_decision`, `review_selection`, `publish_baseline`) невозможно проверить на проде** — там нет этих RPC. Только в AP1-окружении.

---

## 1. Окружение

| | |
|---|---|
| Проект | `remhaos-ap1-disposable` |
| Ref | `uafvzxdxlxqkpsejgskt` |
| Регион | `ap-northeast-1` (как у прода) |
| Стоимость | **$10/мес — удалить после закрытия AP1** |
| Создан | 01.08.2026 |

> **Правило владельца:** удалить сразу после зелёных тестов, сохранённого отчёта и проверки PR. Если AP1 откладывается — удалить, чтобы не платить за простой. Прод от удаления не страдает.

---

## 2. Применение миграций

> ### ⚠️ Папка миграций не bootstrap-ится подряд — `supabase db push` на чистой базе упадёт
>
> Проверено на практике 01.08.2026. `20260716071024_legacy_production_baseline.sql`
> — это **замена** миграциям `0001`–`0007`, а не их продолжение. В нём стоит
> guard, который падает с `legacy production baseline is clean-bootstrap only;
> application relations already exist`, если таблицы уже созданы.
>
> Из шапки самого файла: baseline воспроизводит проверенную продовую схему на
> момент 2026-07-16 и включает эффекты `0001_init`, `0002_client_briefs`,
> `0003_custom_questions`, `0004_designer_profile`, `0006_team` и точного блоба
> `0007_project_rooms`. Исключены `0005_rate_limits` и `0008_concept_packs`
> (в проде отсутствовали), `0009_project_room_workflow` отвергнут как небезопасный.
>
> **Практические следствия:**
> - на чистом окружении применять **baseline, а не 0001–0007**;
> - `0001`–`0007` в папке — исторические, для окружений, где они уже применены
>   до появления журнала;
> - в репозитории под номером `0007` лежит `invite_tokens`, а baseline включает
>   другой исторический `0007_project_rooms` — то есть 0001–0007 **не создают**
>   таблицы Module 3 (`project_rooms`, `project_participants`, `project_tasks`,
>   `project_task_events`), которые есть в проде и в baseline;
> - после baseline **нет** `rate_limits` — если он понадобится, применять
>   `0005_rate_limits.sql` отдельно поверх.
>
> Это прямо конфликтует с требованием AP1 «exact additive migration ledger»
> (MASTER_EXECUTION_PLAN §4) и требует отдельного решения владельца: либо
> пометить `0001`–`0007` как superseded, либо снабдить папку явной инструкцией
> о двух путях bootstrap.

Порядок для **чистого** окружения (baseline + слой ProjectCEO):

```
 1  20260716071024_legacy_production_baseline.sql
 2  20260716072000_project_intelligence_core.sql
 3  20260716073000_project_intelligence_operations.sql
 4  20260717090000_projectceo_foundation_access.sql
 5  20260717091000_projectceo_foundation_ingestion_read.sql
 6  20260717092000_projectceo_foundation_integration_hardening.sql
 7  20260717100000_projectceo_product_brain_persistence.sql
 8  20260717101000_projectceo_product_brain_operations.sql
 9  20260717101500_projectceo_product_brain_relational_hardening.sql
10  20260717102000_projectceo_m4_execution_persistence.sql
11  20260717103000_projectceo_m4_execution_operations.sql
12  20260718124958_projectceo_ap1_authenticated_reads.sql
13  20260718223000_projectceo_ap1_inventory_duplicate_groups.sql
14  20260718225000_projectceo_ap1_legacy_metadata_bridge.sql
```

Историческая последовательность (только для окружений, где она уже применена):

```
 1  0001_init.sql
 2  0002_client_briefs.sql
 3  0003_custom_questions.sql
 4  0004_designer_profile.sql
 5  0005_rate_limits.sql
 6  0006_team.sql
 7  0007_invite_tokens.sql
 8  20260716071024_legacy_production_baseline.sql
 9  20260716072000_project_intelligence_core.sql
10  20260716073000_project_intelligence_operations.sql
11  20260717090000_projectceo_foundation_access.sql
12  20260717091000_projectceo_foundation_ingestion_read.sql
13  20260717092000_projectceo_foundation_integration_hardening.sql
14  20260717100000_projectceo_product_brain_persistence.sql
15  20260717101000_projectceo_product_brain_operations.sql
16  20260717101500_projectceo_product_brain_relational_hardening.sql
17  20260717102000_projectceo_m4_execution_persistence.sql
18  20260717103000_projectceo_m4_execution_operations.sql
19  20260718124958_projectceo_ap1_authenticated_reads.sql
20  20260718223000_projectceo_ap1_inventory_duplicate_groups.sql
21  20260718225000_projectceo_ap1_legacy_metadata_bridge.sql
```

Предпочтительный способ — Supabase CLI (не тянет SQL через контекст агента):

```bash
supabase link --project-ref uafvzxdxlxqkpsejgskt
supabase db push
```

**Проверка после применения** — должны появиться схемы `project_intelligence`, `projectceo_foundation`, `projectceo_product`, `projectceo_product_api`, `projectceo_read_api`, `projectceo_m4`, `projectceo_m4_api`:

```sql
select nspname from pg_namespace where nspname like 'projectceo%' or nspname = 'project_intelligence' order by 1;
```

---

## 3. Пять ролевых пользователей

```bash
AP1_CONFIRM_DISPOSABLE=yes npm run provision:ap1
```

Требует в `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (от AP1-проекта, **не от прода**), `AP1_TEST_PASSWORD`, опционально `AP1_EMAIL_DOMAIN`.

Скрипт создаёт только auth-identity с подтверждённым email. **Членства он намеренно не выдаёт** — по инварианту `AGENTS.md` «human operations не выполняются через service role». Роли раздаются штатным invitation-потоком от лица owner:

| Ключ | Целевая роль | Как получает доступ |
|---|---|---|
| `owner` | `owner_lead` | создаёт Organization и Project |
| `designer` | `architect` | invitation от owner |
| `builder` | `builder` | invitation от owner |
| `client` | `client_approver` | invitation от owner |
| `guest` | — | отдельный guest grant, без членства |

---

## 4. Что именно проверяем (главное)

### 4.1 Semantic hash у `publish_baseline` — основной открытый вопрос

`publish_baseline` подключён (PR #57), но принимает `semanticHash` от клиента и только валидирует формат. RPC пересобирает канонический объект сам и сверяет побайтово, подмешивая `organizationId` и текущие строки `project_packages` — то есть клиент не может вычислить хэш «из воздуха».

Готовый хелпер: `lib/project-intelligence/modules/decisions/baseline-semantic-hash.ts` (PR #58, в `main` не влит на момент написания).

**Прогон:**
1. Создать Organization/Project/Package и хотя бы одну approved `ApprovalPackage` с decision/selection-ревизией.
2. Посчитать хэш хелпером из данных `projectceo_read_api.get_project_workspace_read` (`scope.organizationId` + `data.packages`).
3. Вызвать `publish_baseline` с этим хэшем.

**Ожидаемо:** команда проходит. **Если `BASELINE_SEMANTIC_HASH_MISMATCH`** — сравнить `actualSemanticHash` из ответа RPC с локально посчитанным и найти расхождение в канонизации. Две известные ловушки уже учтены в хелпере: read-RPC отдаёт packages в порядке `stable_key`, а хэш считается в порядке `id`; `_sorted_unique_text_array` дубли не схлопывает, а отвергает.

### 4.2 Остальные ворота

- **AP1** — request-bound Auth/PostgREST, Storage, пять ролевых сессий, redirect allowlist, test-only mail.
- **AP2** — read-контракты не раскрывают private relation names, оригинальные имена файлов, абсолютные пути, signed URLs, чужие пакеты и другую Organization.
- **AP3** — сквозной сценарий Kora: invitation → sources → human review → approvals → baseline → release → distribution → change/impact → photo evidence → acceptance → handover.

Команды, всё ещё недоступные и потому вне сценария: `register_source`, `review_source` (RPC не существуют — нужна новая миграция), `publish_release`, `build_handover` (последняя ведёт в схему `projectceo_m4_api`, куда command-service не маршрутизируется).

---

## 5. Definition of Done

Из `AGENTS.md`:

```
npm run lint
npm run typecheck
npm run test
npm run build
```

Плюс для слоёв БД: disposable PostgreSQL 16 и 17, RLS, negative tenancy/package scope, concurrency, idempotency, rollback, restart replay. Browser acceptance разделяет sanitized fixture QA и настоящую authenticated Auth/PostgREST/RLS matrix — первое не заменяет второе.

`PRODUCTION_READY=true` запрещено до заполненного adoption checklist, свежего production snapshot, backup/restore rehearsal, проверок SMTP/Auth/Storage, monitoring и отдельного человеческого GO.

---

## 6. Закрытие

1. Зафиксировать результаты прогона в отчёте.
2. Проверить и слить PR #58 (или переработать по итогам прогона).
3. **Удалить проект `uafvzxdxlxqkpsejgskt`.**
4. Отдельным решением — судьба репозитория относительно прода (см. §0).
