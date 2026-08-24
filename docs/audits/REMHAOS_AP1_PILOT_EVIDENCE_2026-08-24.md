# AP1 Pilot Evidence — первый полный hosted-пилот AP5 на managed Supabase

**Первая строка (состояние стенда):** проект `remhaos-ap1-pilot`, ref
`qoyemgoskhuqdexlejhp` (организация huqbxcmbidfqverftqrk, платный план,
регион ap-northeast-1), 24.08.2026; `main` = `11aeca9` + PR #103
(verify-runtime/verify-m3 фиксы под новый шлюз); миграций **54/54**,
схем 12, личностей 5, **AP5: 25 passed / 0 failed / 2 skipped (осознанные
исключения)**.

**Режим:** одноразовая среда. Продакшен `ztnycrchwxqczqbyegnp` не тронут
ни одним запросом (гвард `reject_production` в bootstrap + ручная сверка
env). Уровни доказательств — DEC-016.

---

## 1. Что прогонено (VERIFIED, живой прогон 24.08.2026)

| # | Шаг | Результат | Доказательство |
|---|---|---|---|
| 1 | Проект создан через Management API (платная организация — лимит free не применим) | ✅ | `supabase projects create` → ref qoyemgoskhuqdexlejhp |
| 2 | Bootstrap `--target hosted`: роли §2a, 54 миграции clean-bootstrap, ledger, ACL auth, постусловия, exposure, 5 личностей | ✅ | `AP1_BOOTSTRAP_OK target=hosted migrations=54 identities=5`; `AP1_MIGRATION_LEDGER_OK count=54`; `AP1_DB_OK postgres=17.6 … managed_auth_references=0 request_claim_readers=ok` |
| 3 | Границы ДО включения: M3 и M4 закрыты на Data API | ✅ | `AP1_M3_DATA_API_CLOSED_OK`, `AP1_M4_DATA_API_CLOSED_OK` |
| 4 | Включения правильными механизмами | ✅ | `enable-m3-publication.sql`, `enable-m4-increment-1.sql` (COMMIT), V1 — через `open_v1_impact_production('AP5 harness', 'OWNER DECISION 12.08.2026 / DEC-033…')` → `open_now = t` |
| 5 | Приложение собрано и поднято против hosted | ✅ | build PASS; `http://127.0.0.1:3100` → 200 |
| 6 | **AP5: роль-матрица + цепочка Kora, звенья 1–15, пять отдельных browser-сессий** | ✅ | **25 passed / 0 failed / 2 skipped** (2 — fixme: photo/milestone V2; selection на area-узле) |

Звенья цепочки (все на живом стеке): enrollment → приглашения и приём
каждой ролью своей сессией → register_source → review_source (негатив 404)
→ decision human_origin → ingest-узел токеном архитектора → approval
package → review_selection → publish_baseline (+stale-token 409) →
publish_release → distribute_release с настоящим воркером →
acknowledge_release **сессией получателя** → create_change строителем →
V1 Impact: настоящий воркер считает, архитектор рассматривает
(allReturnedImpactsReviewed/coverageComplete/impactReviewComplete),
truncation-дверь отклонена → воркерные RPC недостижимы человеком (звено
13) → partial_depth на настоящей странице (звено 14, точный текст) →
blocked_result_limit на настоящей странице (звено 15, карточек нет,
заявка уходит из очереди).

## 2. Главные доказательства

1. **Блокер `92060e3` (SECURITY DEFINER + auth.uid() от pi_table_owner)
   на managed Supabase НЕ воспроизвёлся** — claim-хелперы из
   `20260801120000` + `20260810040000` работают: все RPC отвечают,
   `managed_auth_references=0`, `AP1_AUTH_WORKAROUND_GRANT_ABSENT`
   (обходной грант §2b не выдавался ни разу). Вердикт: **ЗАКРЫТ**
   (VERIFIED, живой стек).
2. **Канонизация, RLS, идемпотентность, границы** — работают на managed
   без отклонений: негативные пробы звеньев 4/13/14/15 зелёные.
3. **Production-выключатель** на hosted: открытие требует actor+basis,
   `v1_impact_production_state()` → `open_now=t`, ровно две двери.

## 3. Находки (новые, все воспроизведены на живом стеке)

| ID | Severity | Что | Фикс |
|---|---|---|---|
| FIND-01 | major (продуктовая, блокирует hosted-логин) | Hosted GoTrue **не кладёт** `email_verified` в JWT при password-логине (локальный кладёт) → identity-гейт `P1102 identity_unverified`. provision-метка в user_metadata гейтом не читается (верно — юзер может сам её себе поставить) | Хук доступа дополнен веткой `password`: claim ставится **из правды базы** (`auth.users.email_confirmed_at`), не из метаданных. На стенде применён stand-only; продуктовая миграция готовится (требует исключения в auth-regression тесте для хука — он единственный легитимный читатель auth.users). **Хук зарегистрирован в Auth → Hooks владельцем через дашборд** |
| FIND-02 | minor (инфра) | Новый шлюз Supabase отвечает на корневой OpenAPI-эндпоинт 401 `UNAUTHORIZED_INVALID_API_KEY_TYPE` для статических ключей любого типа → verify-runtime и verify-m3 ложнопадали | PR #103: проба реальной таблицы с `Accept-Profile` (406 = не экспонирована). Локальные стеки идут прежним путём |
| FIND-03 | minor (документ) | Exposure схем на hosted не настраивается bootstrap — делается в дашборде (Settings → Data API → Exposed schemas) | Записать в AP1_RUNBOOK §1 как шаг hosted-подъёма |
| FIND-04 | minor (эксплуатация) | Лимит Supabase: 2 активных free-проекта на аккаунт; песочница создана в платной организации (micro, ~$10/мес) | Отметить в runbook: песочницу держать в платной организации |

## 4. Осознанные исключения (не долги)

* **photo/milestone (V2)** — закрыто границей `increment_not_authorized`
  до M4 IMPLEMENTATION GO; `test.fixme` остаётся.
* **selection на area-узле** — узлы kind='area' создаёт только ingest;
  `test.fixme` остаётся.
* **SMTP** — пользователи созданы admin-API с подтверждённым email;
  реальные письма верификации в пилоте не участвовали (разрешено ТЗ).

## 5. Не доказано / вне объёма

* Поведение при рестарте стенда и повторный полный прогон поверх данных
  (цепочка рассчитана на чистый стенд; повторный прогон требует reset —
  показано находкой звена 9 на загрязнённом стенде).
* Telegram TG3 (браузерная вертикаль моста) — вне объёма Фазы 1.
* Хук FIND-01 применён stand-only; до мерджа продуктового PR он остаётся
  одноразовым механизмом стенда.

## 6. Следствие для владельца

Все предпосылки для записи о снятии `PLATFORM_FOUNDATION = BLOCKED`
(в смысле «фундамент репозитория») **выполнены**: пилот пройден на
managed Supabase без обходных грантов, блокер закрыт, исключения
зафиксированы. Черновик:
`docs/canonical/remhaos-v1/drafts/REMHAOS_OWNER_DECISION_PLATFORM_
FOUNDATION_DISPOSABLE_PILOT_DRAFT.md` — ждёт подписи. Production-часть
флага (adoption) остаётся на месте до Фазы 4.

---
*Отчёт составлен по живому прогону 24.08.2026. Секреты стенда в
репозиторий не попадали; .env.local в .gitignore.*
