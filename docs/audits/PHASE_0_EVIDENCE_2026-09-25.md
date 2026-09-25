# Фаза 0 — evidence (25.09.2026)

**Основание:** DEC-040 (решения владельца по `REMHAOS_FINAL_AUDIT_2026-09-25.md` §7),
`REMHAOS_LAUNCH_PLAN_2026-09-25.md` Фаза 0.
**Ветка:** `claude/phase-0-kg4xd8` (от `claude/final-audit-kg4xd8` = `5242a41`, который отличается от
`main` `737795d` только файлами `docs/audits/`). PR не создавался, merge/deploy не выполнялись.
**Код Фазы 0 (проверенный HEAD):** `eb98060faf1860fc1be66d5c053ea18c7522dc97`. Этот документ добавлен
следующим docs-only коммитом поверх него.
**Не затрагивалось:** production Supabase `ztnycrchwxqczqbyegnp`, shared/hosted окружения, R1-миграции и
R1-тесты (`git diff 5242a41 eb98060 --name-only | grep -i r1_` — пусто), флаги `REMHAOS_*`, Vercel.

Уровни — по DEC-016. Всё ниже — VERIFIED прогоном в этой сессии, кроме явно помеченного.

## 1. Что сделано

| Решение DEC-040 | Изменение | Доказательство |
|---|---|---|
| (3) `/b/` закрыт до подтверждения личности | Удалены `app/b/[token]/page.tsx` и `components/share-brief.tsx`; цель `public-brief` убрана из обоих allowlist service-role (`lib/supabase/token-scoped.ts`, `regional-admin.ts`); экраны «готово» самостоятельного брифа больше не выдают ссылку (`app/i/[token]/page.tsx`, `wizard.tsx`), тексты — `lib/i18n/ru.ts`; service worker сменил кэш на `remhaos-v2` (старый кэш с копиями `/b/` удаляется при activate) и не кладёт в Cache Storage страницы по токену и кабинет (`public/sw.js`) | `tests/release/phase0-m1-guards.test.ts` («/b/ is closed»: нет маршрута, нет `/b/` ни в какой форме в `app`/`components`/`lib`, кроме списков noindex; SW не кэширует токен-страницы) |
| BUG-02 повторная отправка брифа | `lib/intake-status.ts` (открытые статусы: created/brief_sent/brief_in_progress); `/api/intake/submit` → 409 `already_submitted` вне открытого статуса, переход проекта условный (`.in("status", …)`), проигравший параллельный запрос не трогает карточки рисков; ответы пишутся до перехода (сбой после перехода не теряет ответы); `/api/intake/upload` → 409 после отправки; визард показывает «готово» на 409 | `phase0-m1-guards.test.ts` (4 статуса → 409 без единой записи; проигранная гонка не доходит до `risk_cards`; вложения закрыты) |
| BUG-03 правка выданного КП | `saveProposal`/`rebuildProposal` — только черновик, запись с `.eq("status","draft")`; редактор блокирует текст и пересоздаётся при смене статуса; страница КП не переписывает выданное КП | `phase0-m1-guards.test.ts`; `tests/db4/79_m1_proposal_lifecycle_guard.sql` (правка выданного → `PROPOSAL_CONTENT_LOCKED`, в т.ч. для service role) |
| BUG-04 approval только в server action | Миграция `20260925090000_legacy_m1_proposal_lifecycle_guard.sql`: триггер `proposals_lifecycle_guard` (SECURITY INVOKER). Для конечного пользователя: вставка только черновиком; draft→sent только при утверждённом `project_passport` approval (читается тем же request-bound RPC, что и в приложении); удаление выданного КП запрещено. Для всех ролей: содержимое не-черновика неизменяемо; разрешены лишь draft→sent и sent→accepted (последний — только серверный путь ответа клиента). `sendProposal` больше не откатывает accepted→sent и двигает проект только вперёд | DB4 79: без approval → `PROPOSAL_APPROVAL_REQUIRED`; вставка `sent` → `PROPOSAL_INSERT_MUST_BE_DRAFT`; с approval (create→submit→decide через RPC) → sent, `sent_at` проставлен; accept/to_draft/delete конечным пользователем — каждый своим отказом; service role: sent→accepted проходит, draft→accepted и sent→draft/accepted→sent отклонены; черновик редактируется. `tests/projectceo-integration/m1-proposal-approval.test.ts` проверяет фильтры |
| (2) пакетный architect — 6 прав; отзыв; аудит прав | Миграция `20260925091000_projectceo_package_capability_template_ledger.sql`: триггер-clamp на `package_member_capabilities` для продуктовых путей (SECURITY DEFINER-функции `pi_table_owner`: enrollment, приглашение) — только `_package_role_capabilities(role)`, отказ пишется в журнал как `denied_by_template`; append-only `capability_grant_ledger` (baseline/granted/revoked/denied_by_template, причина, actor) на обеих таблицах прав; `verify_capability_grants()` (право вне шаблона; расхождение состояния с журналом; проектное членство не-владельца без принятого проектного приглашения); `_revoke_legacy_capability_grants()` — отзывает пакетные права вне шаблона и проектный доступ участников enrollment без приглашения (членство → inactive), дополняет активное пакетное членство шаблоном роли; миграция вызывает её глобально, пишет baseline и падает, если сверка не пуста. Поверхность журнала закрыта от API-ролей. UI: `capabilitiesForScope`/`canInScope` в `components/projectceo/role-policy.ts`, `live-read-port.ts` не предлагает пакетному участнику операции вне шаблона. Внешний поток AP6 (`tests/ap1/e2e/provision-kora.ts`) переведён на владельца для decision/selection/price | DB4 80: пакетный architect после enrollment — ровно 6 прав; `publish_release`/`publish_baseline`/`manage_budget` → `denied_by_template` в журнале и P1103 на `_authorize_package_human`; унаследованное состояние обнаруживается сверкой, отзыв даёт точные счётчики, отозванный участник теряет проектный доступ (P1103) и сохраняет 6 пакетных прав, приглашённый проектный architect не затронут, журнал неизменяем (55000). `tests/projectceo-ui/roles.test.ts` (паритет UI-зеркала с `_package_role_capabilities` по миграции); `tests/ap1/e2e/provision-kora-enrollment.test.ts` |
| (7) CI на каждом PR | `.github/workflows/ci.yml`: возвращён `pull_request: [opened, synchronize, reopened]` (как до `07e186d`); blocking jobs (`scope`, `gates`, `database`, `execution_database`, `ap5`) без event-зависимых job-level `if` | `tests/release/ci-pull-request-trigger.test.ts` — проверено, что тест падает на `ci.yml` до правки |
| Журнал | DEC-040 добавлен в `REMHAOS_DECISION_LOG_v1.md` с исполненной и неисполненной частью | — |

## 2. Прогоны (точный HEAD, чистое дерево)

`HEAD = eb98060…`, `git status --porcelain` пусто до и после; ledger миграций `sha256sum -c` — 129/129 OK.
Среда: облачный контейнер сессии, Node 22.22.2, docker 29.3.1, образы `postgres:16-alpine`,
`postgres:17-alpine`. Команды — только из `package.json`.

| Команда | Результат | Время (UTC) |
|---|---|---|
| `npm ci` | OK, `npm audit` 0 уязвимостей (снято при аудите на тех же package.json/lock) | — |
| `npm run lint` | exit 0 — 0 ошибок, 15 предупреждений (столько же, сколько на `737795d`) | 18:51:09–18:51:30 |
| `npm run typecheck` | exit 0 | 18:51:30–18:51:55 |
| `npm run test` | exit 0 — **259/259 файлов, 2342/2342 тестов** | 18:51:55–18:52:27 |
| `npm run build` | exit 0 | 18:52:27–18:53:08 |
| `npm run test:db4` PG16 | exit 0 — `DB4_M1_PROPOSAL_LIFECYCLE_GUARD_OK`, `DB4_PACKAGE_CAPABILITY_TEMPLATE_LEDGER_OK`, `DB4_PRODUCT_BRAIN`/`TELEGRAM_UPGRADE`/`IMPACT_UPGRADE_HARNESS_OK` | 18:53:08–18:56:05 |
| `npm run test:db5` PG16 | exit 0 — `DB5_EXECUTION_HARNESS_OK` | 18:56:05–18:56:39 |
| `npm run test:db4` PG17 | exit 0 — те же пять маркеров | 18:56:39–18:59:35 |
| `npm run test:db5` PG17 | exit 0 — `DB5_EXECUTION_HARNESS_OK` | 18:59:35–19:00:11 |
| AP5 / hosted / внешний финализатор WP-32 | **не запускались** (см. §4) | — |

Промежуточные прогоны (`be43cc9`: 2338/2338, DB4/DB5 PG16/17 зелёные) сохранены в истории сессии; итоговым
считается только прогон на `eb98060` выше. Файл `adopt-production.contract.test.ts` (docker, таймаут 5 с)
однажды упал по таймауту при параллельной нагрузке docker и прошёл при повторе — в итоговом прогоне зелёный;
это существующая хрупкость теста, не изменение Фазы 0.

## 3. Независимое ревью

Отдельный агент, только чтение, два раунда.

* Раунд 1 по `be43cc9`: REQUEST CHANGES — 2 major (F1 внешний поток AP6 просил пакетного architect о
  decision/selection; F2 отзыв оставлял участника enrollment до WP-32 вовсе без доступа), 4 minor, 6 nit.
  Исправлено в `bca6a54` (F1–F4, F6–F11).
* Раунд 2 по `bca6a54`: **APPROVE WITH NITS**, новых проблем безопасности нет. Замечания F3′/F4′/F7′/F2b
  исправлены в `eb98060`.
* Не менялось и вынесено владельцу: F5, F12 (см. §5).

## 4. Известные ограничения

* **AP5 (Playwright) и hosted-приёмка не запускались** — NOT_VERIFIED: `run-local.zsh` принимает только
  Colima-сокет или раннер GitHub Actions. Первый PR с этой веткой прогонит AP5 в CI (после required check).
* **Внешний финализатор WP-32 не запускался** (требует Colima-профиль владельца). Изменение
  `provision-kora.ts` проверено статически; runtime-подтверждение — на первом прогоне финализатора.
* Clamp пакетных прав срабатывает для продуктовых путей (`current_user = pi_table_owner`). Прямой
  привилегированный SQL (оператор, R1-фикстуры) не блокируется, но журналируется и виден
  `verify_capability_grants()` как `package_capability_outside_template`. Глобальная сверка в DB4 не
  требуется пустой из-за R1-фикстур (R1 не менялся по DEC-040).
* Отозванному участнику повторное проектное приглашение сейчас отклоняется `RECIPIENT_ALREADY_HAS_SCOPE`
  (членство inactive, на него ссылаются FK). Восстановление проектного доступа — отдельный аудируемый
  путь (записано в DEC-040).
* Если запись карточек или события упадёт после перехода статуса, повтор получит 409, событие
  `brief_completed` не восстановится автоматически (ответы и паспорт сохранены). Полное решение — одна
  RPC-транзакция для паспорта, статуса и ответов.
* Не исполнено этой фазой по DEC-040: (4) гейт persisted handoff для baseline/release M3; (6) описание
  контуров Telegram; required status check в branch protection.

## 5. Нужно от владельца

1. **GitHub → Settings → Branches → `main`:** сделать `lint / typecheck / test / build`, `database`,
   `execution_database`, `ap5` обязательными проверками. Без этого «обязательный CI» — только триггер.
2. **F5:** удаление проекта членом студии каскадом удаляет выданное/принятое КП, и ссылка клиента
   `/p/` перестаёт работать. (а) допустимо (дизайнер удаляет свой проект целиком); (б) запретить удаление
   проекта с выданным КП.
3. **F12:** база, как и приложение, принимает любой утверждённый `project_passport` approval, включая
   самоодобрение с маркером (DEC-010). (а) достаточно; (б) требовать конкретную `approver_capability`
   и/или второго человека.
