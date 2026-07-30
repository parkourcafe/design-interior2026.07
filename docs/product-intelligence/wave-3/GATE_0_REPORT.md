# ProjectCEO RU — Gate 0 Report

Дата фиксации: 17 июля 2026 года.
Статус: **PASS / MATERIALIZED**.
Production изменён: **нет**.

## 1. Зафиксированный baseline

- Materialization commit:
  `4644cc9b8720e439946578a00ab24a579627b563`
- Git tree:
  `1ed29b8ab3eb16ee1b4f2f1ca38e1cb2e4747cb3`
- Предварительный архив до очистки:
  `/private/tmp/projectceo-gate0-preclean-20260717.tgz`
- SHA-256 архива:
  `d8cfa7abbf0a57de0ef68570451f48f252f7fc29715f75f1a3b1479446fb9b20`

Архив создан до восстановления и нормализации файлов. Он исключает `.git`,
`node_modules` и `.next`, но сохраняет рабочие изменения и локальные артефакты.

## 2. Принятые решения по конфликтам

1. Активной migration chain признаны только timestamped migrations:
   - `20260716071024_legacy_production_baseline.sql`;
   - `20260716072000_project_intelligence_core.sql`;
   - `20260716073000_project_intelligence_operations.sql`.
2. Старые исполняемые migrations `0001–0008` перенесены в документальный архив.
   Непринятый `0009_project_room_workflow.sql` сохранён только как evidence и не
   возвращён в исполняемую chain.
3. `lib/i18n/ru.ts` и `app/legal/privacy/page.tsx` восстановлены; RU-строки удаления
   аккаунта добавлены.
4. Семь случайных дублей `* 2.ts` удалены.
5. Architecture v1, domain contract и runtime exports синхронизированы.
6. Legacy Project Room не подключён к отклонённым RPC из `0009`.
7. В корне репозитория зафиксирован отдельный `AGENTS.md` для ProjectCEO Wave 3.

## 3. Контрольные хеши

| Артефакт | SHA-256 |
|---|---|
| legacy production baseline | `12aa89db579f7608d7cb3df71e9927ae904734cb9d92b97b640766cf0607c016` |
| Project Intelligence core | `9315a5a547b12aac2c624da3ebb97753994dd15d6528ce85cd430d290a0a6aa5` |
| Project Intelligence operations | `a95b9681b8da98f3b99196ec0ab05b0631ab36741efaa1262fc1ea40f8cf6890` |
| Architecture/contract/runtime aggregate | `c74d5a3f9204b10c458c7699d272d17b2332ec53c6dd14d4bcee78ef776ea545` |
| repository `AGENTS.md` | `4840206ecf71833215e56f37422e4155c0887c5b417db767befbd90eb6a9a9a2` |
| `.vercelignore` | `b833aeddc44da3753dcd81ec6380d7992d2f243b8358ae21d7a7c94acb6e15b4` |

## 4. Проверки

| Проверка | Результат |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test` | PASS, 35 файлов, 223/223 |
| `npm run build` | PASS |
| `npm run release:check` | PASS |
| DB2 PostgreSQL 16 | PASS |
| DB2 PostgreSQL 17 | PASS |
| RLS / ACL / executor roles | PASS |
| immutability / idempotency / rollback | PASS |
| concurrency / restart replay | PASS |
| staged diff whitespace check | PASS |
| секреты в добавленных файлах | реальные ключи не обнаружены; только env placeholders и имена переменных |

## 5. Kora и граница публикации

Kora Food Hall остаётся эталонным локальным проектом для полного Project Graph.
Текущая static demo содержит реальные имена и структуру исходных файлов, поэтому:

- `public/kora-project-intelligence/**` исключён из Vercel deployment через
  `.vercelignore`;
- production UI не должен читать static manifest;
- в production допускается только авторизованный DB-backed read model;
- перед публикацией репозитория отдельно проверяется, не является ли его remote
  публичным.

## 6. Риски, перенесённые в Foundation/P0

Gate 0 не объявляет текущий продукт production-ready. До приглашения внешних
участников необходимо закрыть:

1. password registration, подтверждающий email без доказанного владения ящиком;
2. legacy invitation activation по одному совпадению email;
3. plaintext participant tokens без полного expiry/revoke lifecycle;
4. project/package-scoped AccessGrant вместо studio-wide доступа;
5. one-project/one-organization invariant;
6. signed URL TTL не более 15 минут;
7. совместимость удаления аккаунта с новыми immutable/restrict relations;
8. исключение direct private-table и service-role human actions.

## 7. Следующий gate

Wave 3 Foundation начинается только от materialized commit выше:

1. Organization/Project enrollment;
2. Invitation и AccessGrant с recipient binding, scope, expiry и revoke;
3. package identity и capability matrix;
4. RLS-scoped read model;
5. source registration и storage authorization probe;
6. application adapters для DB2 RPC;
7. затем DB-backed Kora import и M2/M3/M4 vertical slice.
