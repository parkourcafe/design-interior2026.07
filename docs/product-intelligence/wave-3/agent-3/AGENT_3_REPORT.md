# Agent 3 — ProjectCEO Product UI / Pilot Report

Дата: 17 июля 2026 года.
Статус: **UI tranche C0/C1 complete; backend adoption pending integration gate**.

## Результат

Собран русский mobile-first vertical slice ProjectCEO для полноразмерного
проекта Kora Food Hall, 1 800 м². UI работает только через versioned typed port и
детерминированную sanitized projection. В ProjectCEO route нет direct Supabase,
admin client, `fetch`, private-table access, production filenames или локальных
путей.

Маршруты:

| Route | Назначение |
|---|---|
| `/dashboard/projectceo` | Портфель, три оплаченных pilot scopes, onboarding, invitation/grant preview |
| `/dashboard/projectceo/projects/kora-food-hall` | Полный ProjectCEO workspace Kora |

Навигация workspace:

```text
Обзор
Источники
Решения и материалы
Baseline
Выдачи
Изменения
Участники
История
```

Этажи, зоны, дисциплины и delivery packages остаются scope/filter внутри одного
Project; Kora не разбивается на отдельные room-проекты.

## Реализованный UI contract

- `projectceo-ui/0.1`;
- envelope `contractVersion/requestId/data|error`;
- стабильные safe error codes;
- отдельный `ProjectCeoUiReadPort`;
- deterministic frozen mock adapter;
- deployable route получает ровно один server-derived role и один DTO;
- actor/project/package/capabilities приходят в UI как server-scoped DTO;
- sibling role projections не сериализуются в клиент;
- client-side role switching отсутствует;
- guest требует exact package и видит только текущую опубликованную выдачу;
- original filename отсутствует в DTO.

В текущем локальном demo server role определяется только через
`PROJECTCEO_DEMO_ROLE` с безопасным default `owner`. Query parameters и client
state не могут сменить роль. После Foundation integration этот resolver
заменяется authenticated membership/capability derivation.

## Kora golden projection

| Показатель | Значение |
|---|---:|
| Площадь | 1 800 м² |
| Physical source records | 209 |
| Materialized records | 81 |
| Placeholders | 128 |
| Logical blobs | 28 |
| Duplicate groups | 18 |
| Quarantined groups | 8 |
| Human review queue | 11 |

В UI генерируются 209 безопасных registry records `SRC-001…SRC-209`, без имён
файлов. Показываются availability, status, checksum projection, duplicate aliases,
quarantine и human review state.

## Role matrix

| Возможность UI | Owner | Architect / PM | Builder | Client | Guest |
|---|---:|---:|---:|---:|---:|
| Полный Project overview | yes | yes | published scope | published scope | exact package |
| Source registry/review | yes | yes | no | no | no |
| Decisions/selections | yes | yes | propose/read | approve/read | no |
| Publish baseline/release | yes | yes | no | no | no |
| Acknowledge release | yes | yes | yes | yes | exact package |
| Create ChangeRequest | yes | yes | yes | yes | no |
| Review impact | yes | yes | read/comment projection | read/comment projection | no |
| Photo evidence | yes | yes | yes | no | no |
| Participants/access admin | yes | no | no | no | no |
| Private history projection | yes | yes | no | no | no |

UI role labels не являются authorization. Матрица нужна только для отображения;
окончательное разрешение команды обязано вычисляться Foundation adapter/server.

## User journeys

Реализованы:

1. Owner onboarding: Organization, full Project, work-package explanation,
   invitation preview, safe copy link, pending/accepted/revoked/expired states.
2. Source registry: list/search/filter, 209 records, detail, provenance,
   duplicate/quarantine, confirm/reject/clarification preview.
3. Decisions/selections: exact revisions, evidence locator, human approval states,
   checked price observation и revision history.
4. Baseline/release: immutable semantic hashes, V1→V2 diff, current/superseded,
   acknowledgement exact version/hash.
5. Thin M4: one real ChangeRequest projection, +180 000 ₽, +2 days, 2/3 impact
   dispositions, photo milestones, handover readiness.
6. Explicit loading/empty/error/stale/revoked/expired states.
7. Scenario switcher для deterministic state walkthrough.
8. Role matrix вынесена в `tests/projectceo-ui/role-harness.ts`; она не входит в
   deployable authorization flow.

Все mutation controls в этой tranche — безопасный local preview. Они не пишут в
Supabase и не имитируют production success. Подключение к agent-1 Foundation
commands/read model является отдельным integration step.

## Analytics dictionary

Разрешённый controlled event allowlist:

```text
organization_created
project_created
invitation_sent
invitation_accepted
invitation_revoked
source_registered
source_reviewed
baseline_published
selection_reviewed
release_published
release_distributed
release_acknowledged
change_requested
impact_reviewed
second_project_started
```

Analytics не заменяет append-only audit. Email, raw token, signed URL, original
filename и private relation name в event payload не предусмотрены.

## QA

Команды и результат:

```text
npm run lint       PASS
npm run typecheck  PASS
npm run test       PASS — 46 files, 278 tests
npm run build      PASS — ProjectCEO routes compiled
```

Scoped ProjectCEO suite:

```text
5 files
24 tests
24 passed
```

Проверено тестами:

- Kora 209/81/128;
- exact guest package;
- no cross-project leakage;
- no source/member/audit enumeration for guest;
- controlled errors;
- no direct Supabase/fetch/table access;
- deployable routes hydrate one server-derived actor/view only;
- no client role switch or sibling role DTO hydration;
- no role override through query parameters;
- all ProjectCEO display copy comes from `lib/i18n/ru.ts`;
- no production filenames/local paths;
- invitation/grant lifecycle;
- exact revision/evidence/price;
- current/superseded release;
- real change delta/impact;
- photo milestones и incomplete handover;
- three paid pilot scopes и second-project signal.

## Pilot exit gate

| Gate | UI tranche | Production pilot |
|---|---|---|
| `NO_MANUAL_SUPABASE` | yes: UI не использует Supabase напрямую | pending Foundation command integration |
| `ROLE_SCOPED_UI` | yes | pending authenticated browser QA |
| `KORA_FULL_PROJECT` | yes | pending real read-model hydration |
| `RELEASE_ACK_FLOW` | deterministic preview | pending persisted command |
| `ONE_REAL_CHANGE` | golden Kora projection | pending persisted live project |
| `MOBILE_PARTICIPANT_FLOW` | responsive implementation | pending device/browser evidence |
| `THREE_PAID_PILOT_SCOPES_MAPPED` | yes | requires customer identity binding |

## Известные ограничения

1. Mock port не является production adapter.
2. Mutation buttons меняют только local UI state.
3. `PROJECTCEO_DEMO_ROLE` является только server-controlled demo resolver, не
   production authorization.
4. Реальные invitation tokens, storage URLs и filenames намеренно не включены.
5. Authenticated browser screenshots и device QA должны выполняться после
   integration с Foundation read/command port; текущая сборка проверена compile,
   contract и static-boundary тестами.
6. Второй и третий pilot scopes показаны как mapped portfolio entries, но
   интерактивный golden workspace сделан только для Kora.

## Следующий integration gate

1. Заменить `createProjectCeoMockPort()` на authenticated Foundation adapter,
   сохранив `ProjectCeoUiReadPort`.
2. Заменить `PROJECTCEO_DEMO_ROLE` на role/capability, выведенные из
   authenticated membership server-side.
3. Связать local mutation previews с server route handlers/application commands.
4. На server-side повторно проверить actor, Organization, Project, package,
   membership и capability.
5. Выполнить authenticated browser QA owner/architect/builder/client/guest.
6. Только после зелёных DB3 + browser tests принимать production-adoption
   решение.
