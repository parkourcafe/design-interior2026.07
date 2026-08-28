# M2 pilot-evidence: построчный разбор executor-скриптов (закрытие −2 баллов)

> Параллельное независимое прочтение тех же скриптов другим потоком
> принято владельцем на main (PR #114):
> `M2_EXECUTOR_SCRIPTS_REVIEW_2026-08-24.md` (находки REV-01/REV-02).
> Настоящий документ — построчное прочтение Потока 3 (ТЗ Фазы 3, п. 3a.7)
> с реестром дефектов D1-D7; фиксы D1/D2 — в этом же PR отдельным коммитом.

Дата: 2026-08-24
Основание: план запуска, Фаза 3, п. 3.5 (`docs/audits/REMHAOS_LAUNCH_PLAN_2026-08-23.md:118`) —
«Чтение executor-скриптов M2 pilot-evidence (закрытие −2 балла) + фиксация import gaps».
Режим: READ ONLY — ни один скрипт не изменён; все найденные дефекты предназначены
для отдельного PR.

## 1. Претензия, на которую отвечает отчёт

Штраф −2 балла назначен владельцем в `docs/product-intelligence/M2_CLOSEOUT_2026-08-08.md:38-41`:

> «**2 — техническое чтение двух executor-скриптов.** Владелец прочитал
> продуктовую часть и нашёл две настоящие проблемы … **Правильность
> shell-логики никем не читана.**»

Финальный аудит перенёс это в реестр «не проверено»
(`docs/audits/REMHAOS_FINAL_AUDIT_2026-08-23.md:169`): «Непрочитанность
executor-скриптов (−2 балла M2) — процессное утверждение closeout, из
репозитория неверифицируемо. Компенсация: скрипты присутствуют; упомянутый баг
zsh исправлен в коде (`run-m2-pilot-evidence.zsh:18-27`)».

Этот отчёт выполняет именно недостающее действие: полное построчное чтение
**всех четырёх** shell-исполняемых файлов конвейера (не только двух, названных
в closeout), их allowlist'а и всех TypeScript-модулей, которым shell передаёт
управление. Найденные дефекты (§5) — прямое доказательство, что чтение было
настоящим, а не формальным.

## 2. Метод и словарь достоверности

Словарь — по DEC-016, только словами (проценты запрещены):

- **VERIFIED** — проверено исполнением детерминированной команды в этой сессии
  (например, `sha256sum` по файлам).
- **CODE_PRESENT** — прочитано в коде построчно; поведение выведено из кода, но
  не исполнялось (в среде ревью нет node_modules и docker-стека:
  `node_modules/.bin/vitest` отсутствует — проверено, VERIFIED).
- **DOC_TARGET** — заявлено документом, кодом не подтверждено.
- **NOT_BUILT** — отсутствует.

## 3. Инвентарь прочитанного

Прочитаны полностью все 20 файлов каталога `tests/pilot-evidence/` (листинг —
VERIFIED, глоб по каталогу):

| Группа | Файлы |
|---|---|
| Shell-исполняемые (4) | `run-m2-pilot-evidence.zsh` (105 строк), `executors/kora-five-session-producer.zsh` (130), `executors/external-package-runner.zsh` (291), `executors/pending-external-system.zsh` (7) |
| Allowlist (1) | `executors/allowlist.json` (21) |
| TS-конвейер (9) | `run-m2-pilot-evidence.ts`, `run-pilot-executor-cli.ts`, `finalize-m2-pilot-evidence.ts`, `finalize-m2-pilot-evidence-cli.ts`, `external-pilot-receipt.ts`, `external-pilot-receipt-cli.ts`, `kora-five-session-receipt.ts`, `kora-five-session-receipt-cli.ts`, `m2-pilot-evidence-contract.ts` |
| Тесты (6) | `m2-pilot-evidence.test.ts`, `m2-pilot-executor-identity.test.ts`, `m2-pilot-finalizer-adversarial.test.ts`, `external-pilot-receipt.test.ts`, `kora-five-session-receipt.test.ts`, `m2-pilot-external-manifest.gate.test.ts` |

Других allowlist/manifest-файлов в `tests/pilot-evidence/` нет. Kora-манифест
живёт в `tests/fixtures/cycle7/kora-one-room-pilot.json` (единственный файл
каталога — VERIFIED, листинг); внешний манифест
`external-package.manifest.json` отсутствует **намеренно** — красный гейт
`test:cycle7` требует его существования
(`tests/pilot-evidence/m2-pilot-external-manifest.gate.test.ts:10-15`,
`package.json:12`).

## 4. Разбор скриптов

### 4.1 `tests/pilot-evidence/run-m2-pilot-evidence.zsh` — оркестратор Цикла 7

Статус: CODE_PRESENT (прочитан построчно; не исполнялся — требует docker-стека).

**Что делает по шагам:**

1. `set -euo pipefail`, вычисляет корень репозитория из собственного пути и
   делает `cd` (`:2-5`).
2. Входы: фиксированный Kora-манифест (`:6`), внешний манифест, внешний
   executor и его SHA-256, Kora-producer и его SHA-256 — всё из env
   `ARCHIDOM_*` (`:7-11`); каталог артефактов — env либо
   `/private/tmp/archidom-m2-pilot-evidence` (`:12`).
3. Trap-cleanup: при любом ненулевом выходе удаляет `PENDING.json`,
   `RECEIPT.json`, `KORA_RECEIPT.json` и всегда — `PASS.json.tmp` (`:17-25`).
   Код возврата захватывается в `exit_status`, НЕ в read-only `status` —
   баг из closeout исправлен, о чём говорит и комментарий (`:18-20`).
4. Fail-closed выходы: нет/нечитаем внешний манифест → JSON
   `{"external":{"status":"not_supplied"}}` в stderr, exit 66 (`:27-30`);
   нет исполняемого executor'а → `pending_executor`, exit 67 (`:31-34`).
5. Проверка личности внешнего executor'а — четыре независимых замка (`:35-43`):
   абсолютный путь обязан лежать в `tests/pilot-evidence/executors/` (`:36`),
   файл обязан быть в git-индексе (`git ls-files --error-unmatch`, `:38`),
   фактический `shasum -a 256` обязан совпасть с env-digest (`:39-40`), и пара
   path+digest обязана присутствовать в allowlist с контрактной версией
   (`jq -e`, `:41-43`).
6. Те же четыре замка для Kora-producer'а (`:44-53`).
7. Готовит каталог артефактов: `mkdir -p`, `chmod 700`, `umask 077` (`:54-56`);
   отказывается работать, если `KORA_RECEIPT.json` уже существует (`:57`).
8. Чеканит challenge-nonce `cycle7-challenge-$(openssl rand -hex 24)` и
   verification-id через `uuidgen` (`:58-59`), запускает producer (`:60`).
9. Валидирует полученный Kora-receipt одним большим `jq -e` (`:62-75`): маркер
   `RUN_FIVE_REQUEST_BOUND_SESSIONS`, привязка producer'а (path/digest/nonce,
   `repoOwned`), RFC-4122 receiptId, ровно пять сессий в фиксированном порядке
   ролей, все userId/sessionId/requestId — 36-символьные и попарно различные.
10. Считает digest receipt'а (`:76-77`) и вызывает
    `run-m2-pilot-evidence.ts prepare` (`:79-82`) — тот валидирует оба
    манифеста (`m2-pilot-evidence-contract.ts:28-103`: анти-synthetic,
    анти-клон Kora, provenance, чексуммы источников, приватность путей) и
    пишет `PENDING.json` c `flag:"wx"`, mode 0600
    (`run-m2-pilot-evidence.ts:50`).
11. Прогоняет три фиксированных Kora-гейта: `tests/projectceo-e2e/run-local.zsh`
    и `tests/db4/run.zsh` на PG16 и PG17 (`:86-88`), с честным комментарием,
    что они «не заменяют внешний пакет» (`:84-85`).
12. Запускает внешний executor через `run-pilot-executor-cli.ts` (`:96-99`) —
    тот исполняет его `execFile` без shell-интерполяции, а при провале пишет
    `FAILURE.json` с редакцией секретов и удаляет PASS-артефакты
    (`finalize-m2-pilot-evidence.ts:125-137`).
13. Требует непустой `RECEIPT.json` (exit 68, `:100`) и финализирует через
    `finalize-m2-pilot-evidence-cli.ts` (`:102-103`) — финализатор заново
    перепроверяет ВСЁ (allowlist, digest файлов на диске, привязку PENDING,
    цепочку state-ревизий, пять сессий, lineage, приватность) и публикует
    `PASS.json` атомарно `writeFileSync(wx) + renameSync`
    (`finalize-m2-pilot-evidence.ts:26-123`).

**Читает:** env `ARCHIDOM_*`, оба манифеста, allowlist, Kora-receipt.
**Пишет:** только внутрь `evidence_dir` (PENDING/RECEIPT/KORA_RECEIPT/PASS) —
руками не пишет ни одного receipt'а: их пишут только unit-тестированные
TS-билдеры с `O_EXCL` 0600 (`kora-five-session-receipt.ts:119-123`,
`external-pilot-receipt.ts:259-261`).
**Внешние зависимости:** zsh, git, jq, shasum (perl), awk, openssl, uuidgen,
node/tsx; транзитивно — docker и ripgrep (`tests/db4/run.zsh:16-33` поднимает
одноразовый postgres-контейнер с `--network none` и грепает readiness через
`rg`) и весь AP1/Next/Supabase-стек через producer. Интернет не нужен.
**Деструктивные операции:** только `rm -f` собственных артефактов в
`evidence_dir` при провале (`:21-22`). Вне каталога артефактов ничего не
удаляется и не изменяется.

### 4.2 `tests/pilot-evidence/executors/kora-five-session-producer.zsh` — производитель Kora-receipt

Статус: CODE_PRESENT.

**Что делает по шагам:**

1. Аргументы: nonce и путь receipt'а; отказ при пустых (exit 64) и при уже
   существующем файле receipt'а (exit 65) (`:18-27`).
2. Считает собственный path/digest для самоидентификации (`:29-31`).
3. Константы одноразового стека: контейнер `supabase_db_archidom-ap1-disposable`,
   origin `http://127.0.0.1:3100`, файл сессий и Next-лог в `/private/tmp`,
   `DOCKER_HOST` по умолчанию — colima-сокет (`:33-40`).
4. Trap-cleanup (`:52-71`): гасит Next-процесс (`kill`), удаляет runtime-корень,
   cookie-jar'ы и invite-файлы, файл сессий и Next-лог, workdir; при провале —
   и сам receipt. Захват кода — в `exit_status`, не в `status` (`:53-55`).
   Отдельно задокументирована причина удаления Next-лога: туда попадают
   token_hash из magic-link callback-URL (`:37-39`) — это фикс «утечки
   token_hash» из closeout (`M2_CLOSEOUT_2026-08-08.md:64-65`).
5. Запускает настоящий AP1-прогон пяти сессий
   `AP1_KEEP_EVIDENCE=1 zsh tests/ap1/e2e/run-five-sessions.zsh` с `tee` в лог
   (`:73`); требует в логе одновременно маркер успеха
   `AP1_SUPPORTED_SLICE_E2E_OK` (который несёт `production_changed=false` —
   `tests/ap1/e2e/run-five-sessions.zsh:577`) и `AP1_KEEP_EVIDENCE_ACTIVE`
   (`:75-80`), иначе exit 66 без receipt'а.
6. Харвест по пяти ролям (`:97-117`): userId — из файла сессий AP1 (`jq -er`);
   sessionId — живой `SELECT` из `auth.sessions` через
   `docker exec … psql` (`:99-104`); requestId — живой аутентифицированный
   `curl` к `/api/projectceo/portfolio` под cookie-jar той же роли (`:110-111`).
   Ни один идентификатор не выдумывается — это проверяет и тест
   (`kora-five-session-receipt.test.ts:235-241`).
7. Передаёт харвест unit-тестированному билдеру
   `kora-five-session-receipt-cli.ts` (`:123-124`), который перевалидирует
   каждый идентификатор, маппинг ролей AP1→Cycle7, дистинктность пятёрки,
   маркер прогона и приватность, и пишет receipt `wx`+0600
   (`kora-five-session-receipt.ts:100-123`). Из харвеста наружу выходят только
   role/userId/sessionId/requestId — email'ы, token_hash и пути cookie-jar'ов
   отбрасываются по построению (`kora-five-session-receipt.ts:79-86`,
   тест `kora-five-session-receipt.test.ts:129-144`).

**Читает:** лог AP1-прогона, файл сессий, cookie-jar'ы, `auth.sessions`
одноразовой БД. **Пишет:** только receipt (через билдер) и файлы в собственном
`mktemp`-workdir 0700 (`:42-44`).
**Внешние зависимости:** zsh, docker (exec в контейнер supabase-db), psql
(внутри контейнера), curl, jq, shasum, sed/tee, tsx; AP1-стек целиком
(Next dev-сервер, локальный Supabase). Всё — loopback, интернет не нужен.
**Деструктивные операции:** kill Next-процесса и `rm -rf` runtime-корня,
которые распарсены из строки лога AP1 (`:81-83`) — защищены проверками
`[[ -n … && -d … ]]` (`:60-63`); удаление фиксированных временных файлов
`/private/tmp/projectceo-ap1-*` (`:66`). За пределы одноразового стека и
temp-каталогов ничего не удаляется.

### 4.3 `tests/pilot-evidence/executors/external-package-runner.zsh` — раннер внешнего пакета (AP6)

Статус: CODE_PRESENT. Собственный NOTE честно фиксирует: «it has never been
executed against a real external package, because none has been supplied»
(`:22-27`).

**Что делает по шагам:**

1. Восемь позиционных аргументов от `run-pilot-executor-cli.ts` (nonce, путь
   receipt'а, манифест, verification-id, digest/id Kora-receipt'а,
   path/digest producer'а); отказ при пустых (exit 64), при существующем
   receipt'е (65), при нечитаемом манифесте (66) (`:32-54`).
2. Среду одноразового стека подаёт оператор: `EXTERNAL_RUN_ORIGIN`,
   `EXTERNAL_RUN_DB_CONTAINER`, `EXTERNAL_RUN_COOKIE_DIR` (exit 67 без них,
   `:56-62`); origin обязан быть loopback —
   `http://127.0.0.1:*` / `http://localhost:*`, иначе отказ (`:63-66`). Это
   серверная гарантия «не production».
3. Trap-cleanup: `rm -rf` workdir, при провале — `rm -f` receipt'а (`:79-86`).
4. Извлекает scope (organizationId/projectId/packageId/roomId) из манифеста
   `jq -er` (`:88-91`).
5. `post_command` (`:99-115`): аутентифицированный `curl` POST
   `/api/projectceo/commands` под cookie-jar роли, заголовок Origin,
   требование HTTP 200.
6. `send_command` (`:119-151`) — ядро replay-доказательства: одна и та же
   команда шлётся ДВАЖДЫ; первый ответ обязан быть
   `status=="completed" && replay==false`, второй — `replay==true`
   (`:124-126`); от обоих берётся канонический digest `.result`
   (`jq -cS | shasum`, `:129-130`); auditEventId добирается живым `SELECT` из
   `projectceo_product.audit_events` по commandId (`:134-139`). Replay
   доказывается сравнением, а не утверждением — билдер отклонит расхождение
   (`external-pilot-receipt.ts:146-150`).
7. Пять сессий пакета харвестятся так же, как у Kora-producer'а: живой
   `curl /api/projectceo/portfolio` (requestId, actorId) + `auth.sessions`
   из одноразовой БД (`:156-180`).
8. Пять операций в порядке workflow, payload'ы — из манифеста:
   `publish_m2_layout_version` (`:191-197`), `submit_m2_client_review`
   (`:199-204`), `review_m2_client_submission` от роли client (`:206-215`,
   причина согласования по умолчанию честно говорит, что решение принял
   оператор проверки, — фикс дефекта №5 из closeout;
   переопределяется `EXTERNAL_RUN_REVIEW_REASON`),
   `append_m2_approved_commit_revision` (`:217-222`),
   `publish_m2_m3_handoff` (`:224-229`). CommandId чеканятся из
   `/proc/sys/kernel/random/uuid` (`:191,199,206,217,224`).
9. Lineage собирается из фактических ответов операций (`:232-248`), блок
   proofs — из commands-файла и повторного запроса последнего audit-события
   (`:250-267`; см. дефект D4).
10. Харвест передаётся билдеру `external-pilot-receipt-cli.ts` (`:281-285`),
    который перевалидирует цепочку операций, state-ревизий, replay-digest'ы,
    привязку акторов и приватность и пишет receipt `wx`+0600
    (`external-pilot-receipt.ts:202-261`).

**Читает:** внешний манифест, cookie-jar'ы оператора, БД одноразового стека.
**Пишет:** workdir 0700 и receipt (через билдер).
**Внешние зависимости:** zsh, jq, curl, docker+psql, shasum,
`/proc/sys/kernel/random/uuid` (только Linux — см. D2), tsx; поднятый
оператором одноразовый стек приложения. Интернет не нужен (origin — только
loopback).
**Деструктивные операции:** `rm -rf` собственного workdir и `rm -f` receipt'а
при провале (`:82-83`); мутации состояния — только командами продукта в
одноразовой БД через loopback-API. Файловая система вне workdir не трогается.

### 4.4 `tests/pilot-evidence/executors/pending-external-system.zsh` — граница честности

Статус: CODE_PRESENT. Семь строк: печатает в stderr
`{"status":"pending_external_system","receipt":"not_created"}` и выходит с
кодом 75 (`:6-7`). Никогда не пишет receipt — это исполняемое признание, что
внешней системы нет. Зависимости: только zsh. Деструктивных операций нет.

### 4.5 `tests/pilot-evidence/executors/allowlist.json`

Контракт `archidom.pilot-executor-allowlist/0.1`, четыре записи path+digest
(`:2-20`). Сверка digest'ов с фактическими файлами — **VERIFIED** (прогон
`sha256sum` в этой сессии, 2026-08-24): все четыре совпадают байт-в-байт:

| Файл | Digest в allowlist | Фактический | Совпадение |
|---|---|---|---|
| `run-m2-pilot-evidence.zsh` | `0582874d…` (`:6`) | `0582874d…` | да |
| `pending-external-system.zsh` | `70e5ddb6…` (`:10`) | `70e5ddb6…` | да |
| `kora-five-session-producer.zsh` | `e198100c…` (`:14`) | `e198100c…` | да |
| `external-package-runner.zsh` | `3d1c1fc9…` (`:18`) | `3d1c1fc9…` | да |

Байт-точность allowlist'а дополнительно закреплена регрессионным тестом
(`kora-five-session-receipt.test.ts:275-288`): каждая запись обязана указывать
на существующий исполняемый файл внутри `tests/pilot-evidence/` с точно таким
digest'ом (CODE_PRESENT — тест в этой сессии не запускался, node_modules
отсутствует).

## 5. Найденные дефекты

Скрипты НЕ правились — фиксы предлагаются для отдельного PR.

**D1 (major, блокирует AP6-прогон). Харвест раннера не содержит привязки
актора — билдер отклонит каждый реальный прогон.**
`send_command` пишет в commands-файл поля operation/commandId/requestId/
auditEventId/role/ревизии/digest'ы (`external-package-runner.zsh:141-150`), а
при сборке харвеста `role` удаляется и НИЧЕМ не заменяется:
`commands: [$commands[0][] | del(.role)]` (`:275`). Билдер же требует в каждой
команде `actorUserId`/`actorSessionId` и проверяет их членство в пятёрке
сессий (`external-pilot-receipt.ts:129-130,141`): при отсутствии полей
`text()` даст пустые строки, `bindings.has(":")` — false, и сборка receipt'а
детерминированно упадёт с `EXTERNAL_RUN_COMMAND_ACTOR_UNBOUND`. Тестовый
контракт харвеста эти поля содержит (`external-pilot-receipt.test.ts:42`) —
расхождение именно между shell-раннером и его же tested-контрактом.
*Фикс:* в `send_command` дописывать `actorUserId`/`actorSessionId`, беря их из
уже собранного `sessions_file` (он готов до цикла команд, `:156-180`) через
маппинг jar-ролей owner/client → пакетных owner_lead/client_approver (маппинг
уже существует в `:158`).

**D2 (major, блокирует AP6 на macOS). Чеканка UUID только для Linux.**
Раннер шесть раз читает `/proc/sys/kernel/random/uuid`
(`external-package-runner.zsh:191,199,206,217,224,253`) — на macOS `/proc`
нет, `set -e` уронит скрипт на первой же чеканке. При этом остальной конвейер
рассчитан именно на macOS: DOCKER_HOST по умолчанию — colima-сокет
(`kora-five-session-producer.zsh:40`), каталог артефактов —
`/private/tmp/…` (`run-m2-pilot-evidence.zsh:12`), digest'ы — через `shasum`.
*Фикс:* `uuidgen | tr '[:upper:]' '[:lower:]'`, как уже сделано в
`run-m2-pilot-evidence.zsh:59`.

**D3 (minor, доказательная слабость). `previousStateRevision` фабрикуется, а
не наблюдается.** `previous_state_revision=$(( state_revision - 1 ))`
(`external-package-runner.zsh:133`) — инвариант «resulting = previous + 1»
(`external-pilot-receipt.ts:142-145`, `finalize-m2-pilot-evidence.ts:68`)
выполняется тривиально по построению. Реальную работу делает только сквозная
сцепка между командами (`external-pilot-receipt.ts:153-156`,
`finalize-m2-pilot-evidence.ts:69`), которая подделку всё же ловит.
*Фикс:* харвестить previous из ответа API (если поле есть) либо из state-чтения
перед командой.

**D4 (minor, доказательная слабость). Блок proofs — формальный.** Все пять
«доказательств» (audit/authenticatedRead/privacy/tenancy/replay) получают:
случайный `queryReceiptId` из `/proc/…/uuid`, ОДИНАКОВЫЙ запрос «последнее
audit-событие проекта» и digest commands-файла
(`external-package-runner.zsh:250-267`). Финализатор проверяет только формат
(`finalize-m2-pilot-evidence.ts:82-86`) и публикует в PASS.json
`proofs: {audit: true, …}` (`:117`). Реально доказан только replay (двойной
отправкой в `send_command`); tenancy/privacy/authenticatedRead отдельными
проверками раннера не подтверждаются — их несут фиксированные Kora-гейты
(`run-m2-pilot-evidence.zsh:84-88`), что сам оркестратор честно оговаривает.
*Фикс:* привязать каждый proof к реальной проверке (audit — к уже
харвестенным per-command audit-id; tenancy — негативное чтение чужого тенанта;
privacy — скан receipt'а) либо переименовать поле, чтобы PASS не выглядел
сильнее, чем есть.

**D5 (minor, defense-in-depth). Scope-идентификаторы манифеста уходят в psql
без локальной проверки формата.** `jq -er '.scope.projectId'` без
UUID-валидации (`external-package-runner.zsh:88-91`) интерполируется в SQL
heredoc (`:254-257`). В оркестрированном потоке манифест до executor'а
проходит UUID-проверку prepare-шага (`run-m2-pilot-evidence.zsh:79` →
`m2-pilot-evidence-contract.ts:76-80`), но при ручном запуске раннера напрямую
заслона нет; удар ограничен одноразовой БД. *Фикс:* regex-проверка четырёх
scope-полей сразу после извлечения.

**D6 (minor, консистентность). Три замка проверяют разные префиксы пути
executor'а.** Zsh-гейт и билдер требуют `tests/pilot-evidence/executors/`
(`run-m2-pilot-evidence.zsh:36`, `external-pilot-receipt.ts:33,205-209`), а
финализатор — лишь `tests/pilot-evidence/` (`finalize-m2-pilot-evidence.ts:45`).
Поскольку allowlist содержит сам оркестратор (`allowlist.json:5-7`),
финализатор в одиночку принял бы его как «executor» (тесты этим и пользуются:
`m2-pilot-executor-identity.test.ts:20`). В реальном потоке сдерживается
zsh-гейтом и digest-привязкой. *Фикс:* выровнять префикс финализатора до
`executors/` (с поправкой тестов).

**D7 (minor, документация). Комментарий оркестратора называет четыре
обязательные операции receipt'а** (`run-m2-pilot-evidence.zsh:93-95`), тогда
как код требует пять — включая `append_m2_approved_commit_revision`
(`finalize-m2-pilot-evidence.ts:11`, `external-pilot-receipt.ts:7-13`).
Аналогично валидатор манифеста требует четыре операции в
`authenticatedExercise` (`m2-pilot-evidence-contract.ts:59`). Прав код
(пять); комментарий и, по решению владельца, контракт манифеста — обновить.

**Чего НЕ найдено (важно для симметрии):** ни одного `local status=` (баг
closeout №1 отсутствует во всех трёх cleanup'ах:
`run-m2-pilot-evidence.zsh:20`, `kora-five-session-producer.zsh:55`,
`external-package-runner.zsh:81`; закреплено тестами
`kora-five-session-receipt.test.ts:267-273`,
`external-pilot-receipt.test.ts:247`); ни одного пути записи PASS/receipt мимо
`O_EXCL`-билдеров; ни одной операции против production (origin — только
loopback, `--network none` у DB4-контейнера, `production_changed=false` в
маркере AP1); ни одного секрета или PII в скриптах; деструктивные операции
ограничены temp-каталогами и собственными артефактами.

## 6. Готовность к приёму внешнего пакета (AP6)

`external-package-runner.zsh` существует, покрыт adversarial-тестами со
стороны билдера/финализатора и кодирует весь протокол: пять операций в
workflow-порядке, replay двойной отправкой, живой харвест audit/сессий,
receipt только через unit-тестированный билдер. Но **в текущем виде принять
реальный внешний пакет он не может**:

- **Блокер D1:** первый же реальный прогон детерминированно упадёт на
  `EXTERNAL_RUN_COMMAND_ACTOR_UNBOUND` — receipt не будет написан вовсе
  (CODE_PRESENT, вывод статический, но безальтернативный: путь кода один).
- **Блокер D2 (на macOS):** прогон умрёт ещё раньше, на чеканке первого UUID.
- Сам скрипт это предвидел: «Treat the first real run as part of the review,
  not as a regression» (`external-package-runner.zsh:26-27`).

**Import gaps, видимые из кода:**

1. Нет инструмента построения манифеста из реального пакета: контракт
   (`m2-pilot-evidence-contract.ts:40-103`) требует три варианта с
   layoutRevisionId/semanticHash/selections, provenance цен с observedAt и
   evidence-ссылками, чексуммы источников — конвертер «смета партнёра → JSON
   по контракту» NOT_BUILT; это ручная работа с партнёром (план 3.5:
   «время партнёра»).
2. Нет процедуры подготовки cookie-jar'ов пяти ролей одноразового стека для
   внешнего прогона: раннер лишь читает `EXTERNAL_RUN_COOKIE_DIR` (`:58,101`);
   у Kora их создаёт AP1-прогон, для внешнего пакета скрипта-аналога нет
   (NOT_BUILT; нужен операторский runbook или переиспользование AP1-логинов).
3. Данные пакета должны быть предварительно загружены в одноразовый стек
   (раннер публикует layout по id из манифеста, но сами
   package/room/layout-revision записи в БД кто-то должен создать) — шаг
   «loading» в коде раннера отсутствует, NOT_BUILT.

**Что требует владельца:** доступ к реальному пакету покупателя (решение
Фазы 3 — `REMHAOS_LAUNCH_PLAN_2026-08-23.md:107,126`); решение о PR с фиксами
D1–D2 (без них прогон невозможен) и пере-allowlist'инг новых digest'ов после
правок (обе точки byte-exact: `allowlist.json` + тест
`kora-five-session-receipt.test.ts:286`); выбор машины прогона (Linux vs
macOS) до фикса D2.

## 7. Ответ на −2 балла аудита

Формулировка аудита (`REMHAOS_FINAL_AUDIT_2026-08-23.md:169`) содержала три
утверждения; сверка по каждому:

1. *«Процессное утверждение closeout, из репозитория неверифицируемо».* Верно
   на дату аудита. Настоящий отчёт переводит утверждение в проверяемое: чтение
   выполнено, его артефакт — этот файл с построчными доказательствами и семью
   дефектами, которые нельзя найти, не читая shell-логику (D1 виден только на
   стыке `external-package-runner.zsh:275` ↔ `external-pilot-receipt.ts:141`).
2. *«Скрипты присутствуют».* Подтверждено и усилено: присутствуют, исполняемы,
   git-tracked и byte-exact против allowlist (VERIFIED, §4.5).
3. *«Упомянутый баг zsh исправлен в коде (`run-m2-pilot-evidence.zsh:18-27`)».*
   Подтверждено чтением: захват кода возврата — в `exit_status` (`:20`), во
   всех трёх cleanup'ах, с регрессионными тестами (§5, «чего не найдено»).

Условие штрафа из closeout — «правильность shell-логики никем не читана»
(`M2_CLOSEOUT_2026-08-08.md:38-41`) — данным отчётом закрыто, причём шире
исходной формулировки: прочитаны четыре скрипта вместо двух, плюс весь
TS-конвейер и тесты. Решение о возврате 2 баллов — за владельцем. Важно не
смешивать: найденные D1–D2 относятся к **15-балльной** части («внешний
реальный пакет», `M2_CLOSEOUT_2026-08-08.md:32-36`) — они блокируют AP6-прогон
(п. 3.5–3.6 плана), но не факт чтения, за который снимались 2 балла.

## 8. Ограничения этого ревью

- Динамических прогонов не было: нет node_modules и docker в среде ревью, все
  поведенческие выводы — CODE_PRESENT (статический анализ путей кода).
  Единственные VERIFIED-факты — листинги каталогов и `sha256sum`-сверка
  allowlist'а.
- `tests/projectceo-e2e/run-local.zsh` и `tests/db4/run.zsh` прочитаны
  заголовочно (назначение и зависимости), не построчно — они вне периметра
  п. 3.5 (не executor-скрипты pilot-evidence).
- Фиксы D1–D7 намеренно не внесены: правка любого скрипта меняет его digest и
  требует синхронного обновления `allowlist.json` — это отдельный PR с
  повторным ревью byte-exact-цепочки.
