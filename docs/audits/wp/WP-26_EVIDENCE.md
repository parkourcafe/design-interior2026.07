# WP-26 — BUG-05 (б): страницы дизайнера → request-bound + RLS — EVIDENCE

Дата: 2026-09-10. Ветка: `wp/wp-26-designer-pages-request-bound`. База: `90f72b6ac5381b2b3a4f1108bbdeac93411f0aa7` (current `main`). HEAD: `9b500bf`. PR: #141 (draft, unmerged).

## Основание

[ИЗВЛЕЧЕНО] Карточка WP-26 требует request-bound клиент для аутентифицированных страниц, сужение service-role allowlist до класса (а), полный CI и независимый security review.

[ИЗВЛЕЧЕНО] R26 разрешает текущие token-scoped маршруты до завершения и принятия WP-26; production и новые маршруты не разрешены. Текущий запуск отдельно разрешает необходимые additive migration/RLS/security изменения, commit, push и PR.

[ИЗВЛЕЧЕНО] Архитектура и capability matrix требуют активного членства и server-side scope checks; анонимные legacy event writes не получают широкой INSERT-политики.

## Allowlist по факту

[ИЗВЛЕЧЕНО] Изменённые файлы входят в allowlist WP-26 или обязательный migration/test ledger protocol:

```text
app/api/pilot/route.ts
app/dashboard/projects/[id]/page.tsx
app/join/[token]/actions.ts
app/join/[token]/page.tsx
lib/designer.ts
lib/intake.ts
lib/supabase/token-scoped.ts
supabase/migrations/20260910100000_projectceo_wp26_storage_rls.sql
tests/ap1/environment/migration-ledger.sha256
tests/db4/56_m1_rls_security.sql
tests/layout-studio/integration/integration.test.ts
tests/release/service-role-allowlist.test.ts
docs/audits/wp/WP-26_EVIDENCE.md
```

[ИЗВЛЕЧЕНО] Существующие миграции не переписаны; новая миграция additive.

## Изменения

[ИЗВЛЕЧЕНО] Dashboard page подписывает client-uploads через request-bound Storage client с TTL 900 секунд.

[ИЗВЛЕЧЕНО] Добавлена `20260910100000_projectceo_wp26_storage_rls.sql` (S-MIG #5): private `client-uploads` получает только authenticated SELECT policy, ограниченную project UUID path или path в project answer metadata, принадлежащим студии пользователя. В disposable DB4 storage.objects отсутствует, поэтому migration replayable через guarded DO; на Supabase policy создаётся.

[ИЗВЛЕЧЕНО] `lib/intake.ts`, `lib/designer.ts`, invite preview и invite acceptance используют только purpose-scoped helper; invite acceptance дополнительно сверяет нормализованный authenticated email, атомарно гасит только ещё invited token и сообщает invalid при гонке/повторе.

[ИЗВЛЕЧЕНО] Pilot route переведён на request-bound client и fail-closed (503), когда legacy events RLS не разрешает anonymous pilot insert. Anonymous INSERT policy не добавлялась.

[ИЗВЛЕЧЕНО] Service-role static boundary больше не содержит WP-26 residual raw callers.

## Хотспоты и пины

[ИЗВЛЕЧЕНО] H3–H7, H11 и H14 не затронуты. Public token paths остаются только в class (а) WP-25 helper с точным purpose; authenticated dashboard/studio paths больше не используют прямой admin client.

[ИЗВЛЕЧЕНО] TTL signed URL остаётся 900 секунд; private bucket и replay/one-time invite invariants не ослаблены.

## Миграция

| файл | DB4/DB5-сценарий | S-MIG |
|---|---|---|
| `20260910100000_projectceo_wp26_storage_rls.sql` | `56_m1_rls_security.sql` и full DB4/DB5 harness | #5 |

[ИЗВЛЕЧЕНО] Timestamp выбран после `20260910090000`; существующая очередь и приоритеты не менялись. Migration ledger regenerated.

## Локальные гейты

[ИЗВЛЕЧЕНО] `git diff --check`: exit 0; static allowlist: 20 tests passed; migration integration: 7 tests passed; `npm run typecheck`: exit 0.

[ИЗВЛЕЧЕНО] DB4 PG16 и PG17: `DB4_PRODUCT_BRAIN_HARNESS_OK`.

[ИЗВЛЕЧЕНО] DB5 PG16 и PG17: `DB5_EXECUTION_HARNESS_OK`.

[ИЗВЛЕЧЕНО] `npm run release:check`: lint (0 errors, 13 existing warnings), typecheck, 1606 tests (10 skipped), build — exit 0.

## CI и blind review

[ИЗВЛЕЧЕНО] CI run `34448842912` на SHA `9b500bf`: lint/typecheck/test/build, AP5 authenticated browser matrix, DB4 PG16/17, DB5 PG16/17, change scope и cycle 7 — pass. Hosted AP1/Supabase Preview skipped by workflow; Vercel canceled by ignored build step.

[ИЗВЛЕЧЕНО] Claude review run `34448842879` — pass, без findings.

[ИЗВЛЕЧЕНО] Codex Security scan `75bf6bfc-79c3-407c-9b12-514824d23968` по exact diff завершён: reportable findings 0. Hosted adoption остаётся отдельным gate.

## Не сделано / вынесено

[ИНТЕРПРЕТИРОВАНО] Merge PR #141, shared staging/production migration и deploy не выполнялись. Pilot anonymous event remains unavailable until separately approved contract/policy; это fail-closed поведение.

## Безопасность

[ИЗВЛЕЧЕНО] Production, shared DB, credentials и CI settings не использовались. Секреты в diff и evidence не добавлялись. Existing migrations preserved.
