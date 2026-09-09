# Р26 — существующие service-role исключения — ЧЕРНОВИК

**НЕ ПОДПИСАНО. РИСК НЕ ПРИНЯТ.** Дата подготовки: 2026-09-09.
Пакет WP-25. Подпись/дословное подтверждение владельца: отсутствует.
Этот документ не является OWNER GO, не меняет права БД и не разрешает production.

## Что предлагается рассмотреть

[ИЗВЛЕЧЕНО] Legacy public intake/proposal/room используют service-role
клиент, обходящий RLS, после проверки токена на сервере. Историческое правило
3 допускает такой intake-путь. В том же техническом inventory есть другие
классы: authenticated storage/account deletion и system housekeeping/webhook.
Их нельзя считать token-scoped или автоматически разрешёнными правилом intake.

[ИЗВЛЕЧЕНО] WP-25 сохраняет существующие проверки и запросы; добавляет
`createScopedServiceClient(purpose)` в lib/supabase/token-scoped.ts.
Назначение выбирается из фиксированного списка; неизвестное назначение и
browser execution отвергаются до создания клиента. Это allowlist фабрики,
а не SQL sandbox: клиент по-прежнему обладает прежними правами service_role.
Helper не проверяет токен, actor, project_id или ownership самостоятельно.

## Инвентарь переведённых вызовов и существующие компенсирующие проверки

| Класс | Callers | Существующая проверка / ограничение |
|---|---|---|
| [ИЗВЛЕЧЕНО] Token intake | intake/start, submit, upload | getProjectByIntakeToken: exact token + expiry; project.id из найденной строки |
| [ИЗВЛЕЧЕНО] Public proposal | proposal/respond, p/[public_token] | exact public_token; status sent/accepted; project_id из proposal |
| [ИЗВЛЕЧЕНО] Public brief | b/[token] | exact intake_token; выдача паспорта; **expiry здесь не проверяется** |
| [ИЗВЛЕЧЕНО] Participant room | room/[access_token], project-room/task-status | exact participant token; room scope; canSeeTask/canUpdateTask |
| [ИЗВЛЕЧЕНО] Public bootstrap | client/create | новый серверный makeToken, project без дизайнера; rate limit |
| [ИЗВЛЕЧЕНО] Authenticated storage | brief/custom-question/plan-upload | getStudio, session/RLS lookup project до privileged Storage/answers |
| [ИЗВЛЕЧЕНО] Authenticated deletion | account/delete | auth.getUser, явное подтверждение, поиск проектов по user.id |
| [ИЗВЛЕЧЕНО] System housekeeping | lib/rate-limit.ts, lib/llm/recording.ts | rate_limits/record_ai_call; существующий best-effort/fail-open режим |
| [ИЗВЛЕЧЕНО] System webhook | integrations/telegram/webhook | bridge flag, credentials, secret verification, bounded body/schema до factory |
| [ИЗВЛЕЧЕНО] System worker | integration-gateway/runtime/worker-client | transport flag и наличие credentials до factory; не human RPC authorization |

## Остаточные raw callers — временный inventory, не расширение разрешений

| Файл | Класс / дальнейший владелец |
|---|---|
| [ИЗВЛЕЧЕНО] lib/intake.ts | token/expiry lookup; отсутствует в allowlist WP-25 |
| [ИЗВЛЕЧЕНО] lib/designer.ts | public profile + auth lookup; WP-26 review |
| [ИЗВЛЕЧЕНО] lib/studio.ts | authenticated studio resolution; WP-26 |
| [ИЗВЛЕЧЕНО] app/dashboard/projects/[id]/page.tsx | attachment signing после RLS; WP-26 |
| [ИЗВЛЕЧЕНО] app/join/[token]/page.tsx | invitation metadata; отдельная постановка |
| [ИЗВЛЕЧЕНО] app/join/[token]/actions.ts | authenticated invitation acceptance; отдельная постановка |
| [ИЗВЛЕЧЕНО] app/api/pilot/route.ts | public rate-limited event; отдельная постановка |

## Что доказывает guard

[ИЗВЛЕЧЕНО] AST-проверка сканирует app/lib/components/scripts, включая
новые локальные файлы; нормализует @/ и relative module paths. Новый
прямой импорт raw/helper вне точного списка, privileged re-export,
литеральный dynamic import/require, alias/namespace bypass, use-client
caller или неверный purpose нарушают тест. Ссылки на импортированную
фабрику разрешены только как direct call (включая скобки) или type query;
передача через alias/return/export запрещена. Реальный on-disk negative
fixture проходит через тот же scanner.

[ИНТЕРПРЕТИРОВАНО] Это контроль исходников в CI, не полная защита от
намеренно обфусцированного JS, нового прямого создания Supabase-клиента с
credential, изменения самого guard или использования переданного клиента
вне первоначального вызова. Полный service-role объект не сужен по SQL/API;
RLS остаётся обойдённым. Нужны ревью и последующая замена privileged
human operations на request-bound контракты, где это предусмотрено WP-26.

## Остаточные риски и границы принятия

[ИЗВЛЕЧЕНО] В этом пакете нет аудита всех token expiry/revocation путей,
проверки production DB grants, динамической RLS матрицы или hosted acceptance.
Public b/[token] не использует expiry guard intake helper; это наблюдаемый
остаточный риск, не исправленный молча в пакете import boundary.
[ИЗВЛЕЧЕНО] Rate limit остаётся fail-open при отказе БД; автоматическое
подтверждение риска/решений и новые права не добавлены.
[ИНТЕРПРЕТИРОВАНО] Владелец должен отдельно определить допустимость,
срок и условия временного риска. До явной подписи Р26 пакет не закрыт.

## Решение владельца

Статус: **ОЖИДАЕТ РЕШЕНИЯ**. Дата, срок действия, условия и подпись:
**не заполнены**. Агент не заполняет их от имени владельца.
