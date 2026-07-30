# ТЗ агента 3 — ProductCEO UI, Roles, M4 и Pilot Readiness

## Миссия

Собрать русский role-scoped интерфейс, через который три оплаченных клиента смогут
пройти полный ProjectCEO P0 workflow без ручного редактирования Supabase.

## Входы

- Product Charter v0.3.
- Frozen read/mutation DTO от агента 1.
- M2/M3 application interfaces от агента 2.
- Legacy M1 UI.
- Kora static demo как визуальный/информационный прототип.

## Обязательные user journeys

### C1. Owner onboarding

- создать организацию;
- создать проект;
- выбрать full project или scoped package view;
- пригласить архитектора/строителя/клиента;
- скопировать безопасную ссылку для email/WhatsApp;
- увидеть status invitation/grant.

### C2. Project navigation

Навигация:

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

Filters project/package/floor/zone/discipline не создают отдельные проекты.

### C3. Source registry and review

- list/search/filter;
- availability/status/provenance/checksum;
- duplicates and quarantine;
- source detail;
- review queue;
- confirm/reject/request clarification;
- no misleading “AI approved”.

Production UI получает registry через authenticated read model. Текущий static
`public/kora-project-intelligence/manifest.json` используется только как локальный
prototype и не деплоится с реальными именами файлов.

### C4. Decisions and selections

- show evidence and exact revision;
- create/edit selection candidate;
- submit approval;
- client approve/reject/request change;
- price observation with checked date;
- revision history.

### C5. Baseline and release

- baseline readiness;
- unresolved blockers;
- publish confirmation;
- version diff;
- immutable ProductionPackageVersion;
- export status/hash;
- distribution recipients.

### C6. M4 thin execution

- role-scoped package view;
- acknowledgement exact version/hash;
- create ChangeRequest;
- show cost/time delta;
- impact review;
- publish replacement release;
- clear superseded indicator;
- photo evidence/milestone acceptance;
- handover archive summary.

### C7. Roles

Minimum:

- owner/lead;
- architect/designer/PM;
- builder/contractor;
- client approver;
- supplier/guest read-only where required.

Каждый видит только allowed project/package/actions.

## UX requirements

- русский интерфейс;
- RUB;
- mobile-first participant views;
- share link удобно копируется в WhatsApp, но WhatsApp auth не строится;
- explicit loading/empty/error/stale/revoked/expired states;
- confirmation for irreversible publish/revoke;
- accessibility: keyboard, labels, focus, contrast;
- no raw SQL/storage errors;
- no original filenames or PII in analytics.

## Analytics

Добавить controlled events:

- organization_created;
- project_created;
- invitation_sent/accepted/revoked;
- source_registered/reviewed;
- baseline_published;
- selection_reviewed;
- release_published/distributed/acknowledged;
- change_requested;
- impact_reviewed;
- second_project_started.

Analytics не заменяет audit.

## File ownership

Рекомендуемый scope:

- `app/dashboard/**` ProjectCEO routes;
- `components/projectceo/**`;
- delivery DTO mapping, не persistence;
- UI strings RU;
- browser/component tests;
- pilot QA scripts and report.

Не использовать direct private-table access и admin client для human commands.

## QA matrix

Обязательно проверить:

- desktop/mobile;
- owner/architect/builder/client;
- allowed/denied;
- empty/loading/error;
- invitation expired/revoked;
- stale baseline/change;
- current/superseded package;
- keyboard navigation;
- copy/share link;
- Kora 209-source performance;
- no cross-project leakage.

## Pilot exit gate

```text
NO_MANUAL_SUPABASE=true
ROLE_SCOPED_UI=true
KORA_FULL_PROJECT=true
RELEASE_ACK_FLOW=true
ONE_REAL_CHANGE=true
MOBILE_PARTICIPANT_FLOW=true
THREE_PAID_PILOT_SCOPES_MAPPED=true
```

## Handoff интегратору

- route/screen map;
- screenshots;
- role matrix;
- browser test results;
- analytics dictionary;
- pilot runbook;
- known UX limitations.
