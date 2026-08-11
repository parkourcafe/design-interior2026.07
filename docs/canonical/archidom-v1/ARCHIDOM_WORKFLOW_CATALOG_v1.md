> SUPERSEDED_BY_BRAND_RENAME_2026-07-28. CURRENT_BRAND: RemHaOS. Successor package: docs/canonical/remhaos-v1/. Historical content preserved for provenance.

# ARCHIDOM — WORKFLOW CATALOG v1

## WF-M1-001 · Client Intake to Issued Proposal

**Статус:** Sprint 1  
**Owner module:** M1  
**Trigger:** brief submitted или ручной запуск дизайнером.

| # | Action | cost_class | Human gate | Output |
|---:|---|---|---|---|
| 1 | extract_client_brief | metered_ai | fact review | ProjectFact[] |
| 2 | generate_clarifying_questions | metered_ai | send/review | OpenQuestion[] |
| 3 | build_project_passport | free_deterministic | confirm facts | passport read model |
| 4 | generate_risk_register | hybrid/metered_ai | accept/reject risks | Risk[] |
| 5 | build_scope_draft | free_deterministic | internal review | ScopeItem[] |
| 6 | calculate_fee | free_deterministic | owner/studio approval | fee range |
| 7 | generate_proposal_draft | metered_ai | proposal approval | ProposalVersion draft |
| 8 | issue_proposal | free_deterministic | RELEASE_AUTHORIZED | issued proposal |

Workflow lifecycle:

```text
queued → running → waiting_for_human | pending_cost_confirmation | retrying
       → completed | failed | cancelled | rolled_back
```

Acceptance: provenance, ai_calls, versioning, self_approval marker, RLS, resume/retry and public token regression.

## WF-M2-001 · Passport to Design Freeze

**Статус:** CATALOG_ONLY / NOT AUTHORIZED FOR SPRINT 1

Passport → concepts → three variants → material/budget impact → client approval → Design Freeze.

## WF-M3-001 · Design Intent to Documentation Release

**Статус:** AUTHORIZED BY A5 (подписан 09.08.2026) — в объёме P0 по
`MASTER_EXECUTION_PLAN` §M3

Approved decisions → drawing set → QA/conflicts → specifications → issue package → release authorization.

## WF-M4-001 · Issued Package to Stage Acceptance

**Статус:** PARTIALLY AUTHORIZED BY A6 — INCREMENT 1 ONLY (`distribute_release`, `acknowledge_release`, `create_change`); stage acceptance NOT authorized

Issued baseline → site tasks → RFI/deviation → change/substitution → inspection → evidence → acceptance.

## WF-TG-001 · Telegram Chat Bridge (M3 → M4)

**Статус:** AUTHORIZED BY A7 — P0 ONLY (подписан 11.08.2026, DEC-031).
Разрешены local, CI и закрытый staging с тестовыми участниками; production —
отдельный OWNER GO. Мост выключен по умолчанию.

**Owner module:** ни один — горизонтальный адаптер `Integration Gateway →
Messaging`. Доменные модули остаются единственным официальным входом.

**Состояние гейтов на 11.08.2026 — единая редакция для обоих брендов.**

| Гейт | Статус |
|---|---|
| TG0 | PASS |
| TG1 | **REOPENED** — до принятия C1 Foundation Correction |
| TG2 | **REOPENED** |
| TG3 | **NOT PROVEN** |
| TG4 | BLOCKED_EXTERNAL_CREDENTIALS |
| production | disabled |
| M4 Increment 2 | closed |

Что из прежних формулировок было неверно и снято:

- «TG1/TG2/TG3 proven» — не соответствовало коду;
- «TG3 доказан DB4» — DB4 доказывает контракт базы и не доказывает вертикаль:
  в слитом коде **нет вызова `create_change`**, а браузерного прогона не было;
- «P0 окончательно работает без LLM» — правил недостаточно, обязательное
  извлечение через существующую абстракцию `lib/llm/provider.ts` строится в C3;
- «rule classifier заменяет extraction worker» — не заменяет: правила остаются
  **необязательным дешёвым префильтром**;
- «binding сразу active» — связь рождается `notice_pending` и становится
  `active` только после публикации уведомления участникам.

AP5 в этих прогонах **skipped** и о TG3 не доказывает ничего. Вертикаль M3 → M4
ниже описана как **целевая**, а не как достигнутая.

| # | Action | cost_class | Human gate | Output |
|---:|---|---|---|---|
| 1 | link_telegram_identity | free_deterministic | вход в RemHaOS + одноразовый intent | ChannelIdentityLink |
| 2 | bind_project_chat | free_deterministic | `manage_project_integrations` + admin группы | ProjectChannelBinding (`notice_pending` → `active` после уведомления) |
| 3 | ingest_channel_update | free_deterministic | — (системный adapter) | ChannelEvent (+ ChannelAttachment) |
| 4 | extract_candidate | metered_ai (C3) | — (система ничего не утверждает) | ProjectInboxCandidate (pending) |
| 5 | review_candidate | free_deterministic | **человек в RemHaOS** | подтверждён / отклонён |
| 6 | существующая команда модуля | по модулю | человеческая сессия | ChangeRequest и др. официальные объекты |
| 7 | notify_release_distributed | free_deterministic | — (исходящее уведомление) | сообщение в чат + защищённый deep link |

Первый доказываемый сценарий:

```text
distribute_release → уведомление в Telegram → защищённый переход →
acknowledge_release сессией получателя → сообщение строителя →
change_request_candidate → проверка человеком → create_change
```

Acceptance: дедупликация `update_id`, ревизия при `edited_message`, карантин
вложений, at-least-once доставка с внутренней дедупликацией, RLS
deny-by-default, отсутствие сырого текста и секретов в логах, невозможность
выполнить официальную команду из Telegram.

## Auto-trigger policy

Only `free_deterministic` steps may auto-run without cost confirmation. `metered_ai` waits in `pending_cost_confirmation` when studio threshold is exceeded.
