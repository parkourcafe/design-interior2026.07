# AP1 · Request-bound commands and ArchiDom UI

Дата проверки: 18 июля 2026 года.

## Вердикт

`COMMAND_UI_GATE=PASS_WITH_EXPLICIT_GAPS`

Командный контур переведён с исходной матрицы `7 supported / 9 unavailable`
на `10 supported / 6 unavailable`. Отдельно добавлено request-bound принятие
приглашения. Все действия человека проходят через его Supabase JWT и принятые
RPC; service role, private tables и caller-supplied authority не используются.

Этот результат не является production evidence. Он предназначен для
disposable authenticated AP1 и должен быть повторно проверен пятью отдельными
Supabase-сессиями.

## Поддержанные команды

| Команда | Server-derived / проверяемое основание | UI |
|---|---|---|
| `create_invitation` | project scope, role mapping, state revision, HMAC token digest, idempotency | форма владельца + one-time URL |
| `revoke_invitation` | invitation принадлежит проектной access projection | список приглашений |
| `revoke_guest_grant` | точный grant ID, финальная RPC authorization | карточка гостевой ссылки |
| `acknowledge_release` | только `recipientDistributions` для `auth.uid()`, exact semantic hash | текущая выдача получателя |
| `distribute_release` | artifact/version и recipient из authenticated read; RPC повторно проверяет membership/package | выбор участника в текущей выдаче |
| `create_change` | предыдущая package version и текущий baseline из read projection | форма ChangeRequest |
| `review_change_impact` | impact run + impact существуют в доступном execution package | human disposition controls |
| `upload_photo_evidence` | milestone area + зарегистрированный image source exact revision из того же package | package-filtered форма привязки фото-источника |
| `review_photo_evidence` | photo evidence существует в доступном milestone | accept/reject controls |
| `accept_milestone` | milestone существует; финальная полнота проверяется RPC | кнопка human acceptance |

Отдельный поток `POST /api/projectceo/invitations/accept`:

- принимает только 32-byte opaque token в base64url;
- хеширует token до обращения к PostgreSQL;
- использует JWT вошедшего пользователя;
- сохраняет стабильный server idempotency key;
- не возвращает и не логирует raw token;
- полагается на RPC для confirmed email ownership, AMR, expiry, revoke и exact scope.

Unauthenticated continuation сохраняет только строго валидный внутренний путь
`/projectceo/invitations/<43-char-token>` через password, OTP и OAuth. Любой
внешний, protocol-relative, malformed или расширенный query target сбрасывается
на `/dashboard`; open redirect закрыт негативными тестами.

## Invitation token contract

Для `create_invitation` браузер передаёт только email, публичную роль и
`expiresAt`. Сервер:

1. нормализует email;
2. переводит `client` в database role `client_approver`;
3. ограничивает TTL диапазоном от 5 минут до 30 дней;
4. детерминированно выводит raw token через HMAC-SHA256 с
   `PROJECTCEO_TOKEN_SECRET` не короче 32 bytes;
5. передаёт в RPC только SHA-256 digest;
6. возвращает raw token ровно в one-time invitation URL;
7. при точном retry с тем же `commandId` возвращает тот же URL и DB replay.

Raw token не записывается в таблицы, audit, analytics или application log.

## Exact retry contract

`acknowledge_release` и `distribute_release` используют отдельные additive
request-bound RPC. Их idempotency request digest фиксирует логический payload,
но не меняющийся после первой записи `expectedStateRevision`: replay lookup
выполняется до stale-state проверки первой операции. Поэтому retry с тем же
`commandId` после потерянного HTTP-ответа или перезапуска получает сохранённый
DB result, а изменённый artifact/recipient/distribution/hash даёт
`idempotency_conflict`. Authorization, recipient ownership и exact semantic
hash проверяются до replay.

Если recipient-bound read уже показывает acknowledgement, HTTP-сервис безопасно
возвращает эквивалентный logical replay без повторной записи. Чужой distribution
никогда не попадает в эту projection.

Пять поддержанных M4-команд сохраняют frozen RPC и operation names. Перед
первичной mutation адаптер вызывает узкий authenticated replay probe. Probe
находит только command record того же human actor, восстанавливает исходный
`expectedStateRevision` как `resultingStateRevision - 1`, пересчитывает точный
legacy digest и возвращает сохранённый result. При отсутствии записи выполняется
исходная mutation; изменённый payload с тем же key даёт conflict. Это закрывает
restart replay для ChangeRequest, impact review, photo registration/review и
milestone acceptance без изменения старого ledger-контракта.

## HTTP security coverage

Прямыми вызовами Next route handlers проверены:

- command success;
- unauthenticated и identity-unverified paths;
- same-origin CSRF;
- обязательный `application/json`;
- malformed JSON и strict validation;
- локальный fixture read-only gate;
- downstream `forbidden`, `not_found`, `stale_state`, `expired`;
- unexpected backend error → controlled `internal_error`;
- HTTP status mapping;
- `Cache-Control: private, no-store`;
- отсутствие recipient, raw token и backend detail в error body;
- portfolio и project GET success/error/auth/internal paths;
- invitation acceptance success/error/auth/fixture paths.

Сервер сам выводит idempotency key. Командная схема не принимает от клиента
`actorId`, `organizationId`, authority package, role, state revision или
idempotency key.

## Осознанно недоступные операции

| Операция | Причина fail-closed |
|---|---|
| `register_source` | нет завершённого browser upload → private Storage → inventory/ingestion orchestration |
| `review_source` | нет принятого human source-review mutation RPC |
| `review_selection` | approval package target/decision command ещё не оформлен как строгий UI contract |
| `publish_baseline` | сервер пока не может безопасно собрать полный immutable descriptor и semantic hash только из принятых revisions |
| `publish_release` | exactRevisionRefs + semantic hash требуют deterministic construction gate |
| `build_handover` | операция по принятому контракту worker-only |

Дополнительные явные ограничения:

- форма photo evidence регистрирует уже существующий image source/revision; она
  не загружает raw bytes;
- `create_guest_grant` и guest-link acceptance не входят в текущий command
  contract;
- email/WhatsApp delivery one-time invitation URL остаётся controlled manual
  pilot step;
- SMTP и production adoption не выполнялись;
- live authenticated browser matrix ещё должна доказать пять отдельных сессий.

## Конфигурационные условия AP1

- `PROJECTCEO_TOKEN_SECRET` — server-only, минимум 32 random bytes;
- URL и publishable key Supabase — request-bound cookie client;
- никакого `NEXT_PUBLIC_*` token secret;
- Data API schemas/RPC должны быть явно exposed/granted: в новых Supabase
  проектах таблицы и API exposure больше нельзя предполагать автоматически;
- ответы с session cookies и user data не кэшируются.

## Проверки

На shared-tree snapshot после реализации command/UI и authenticated-read:

- scoped AP1 command/integration/UI/read-static + M4 adapter: `17 files / 104 tests` — PASS;
- полный Vitest: `64 files / 381 tests` — PASS;
- TypeScript strict всего shared-tree — PASS;
- Next production build — PASS;
- lint — 0 errors; новые warning в command/UI отсутствуют;
- `git diff --check` — PASS.
- PostgreSQL 16 (`postgres:16-alpine`) —
  `AP1_AUTHENTICATED_READ_HARNESS_OK`;
- PostgreSQL 17 (`postgres:17-alpine`) —
  `AP1_AUTHENTICATED_READ_HARNESS_OK`.

Оба DB-прогона включали весь migration ledger, ACL/RLS, request-bound
`distribute_release` и `acknowledge_release`, пять M4 exact-retry probes,
changed-payload conflict, wrong-actor denial, read-only replay, 32 параллельных
read/replay запроса и повторную проверку после физического restart контейнера.

## Следующий gate

1. Поднять disposable Supabase и применить additive read migration.
2. Создать owner, architect, builder, client и guest identity/session.
3. Пройти invitation create → login → accept без ручной записи в private tables.
4. Пройти Kora distribution/acknowledgement, change/impact и
   photo/review/milestone через UI.
5. Зафиксировать authenticated tenancy/package negatives и только после этого
   решать, какие из шести fail-closed операций нужны первому платящему wedge.
