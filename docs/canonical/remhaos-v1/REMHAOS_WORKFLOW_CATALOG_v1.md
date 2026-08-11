> Brand-only successor of the corresponding ARCHIDOM document. Product scope and architecture are unchanged except where a later approved addendum explicitly says otherwise.
> Current public brand: RemHaOS. Russian pronunciation: РемХаос. Primary host: https://remhaos.com.

# REMHAOS — WORKFLOW CATALOG v1

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

**Статус:** AUTHORIZED BY A4 (подписан 08.08.2026)

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

**Состояние на 11.08.2026:** TG1, TG2 и TG3 закрыты кодом и доказаны DB4 на
PostgreSQL 16 и 17. TG4 (настоящий бот, настоящая группа) не проводился —
внешних учётных данных нет, статус `TG4_BLOCKED_EXTERNAL_CREDENTIALS`.
Формулировка «staging proven» до реального прогона не применяется.

**Шаг 4 в P0 без LLM.** Классификатор детерминированный, `origin = 'rule'`.
Схема кандидата уже различает `rule` и `ai`, поэтому появление модели позже не
меняет ни контракта, ни границы: человек в обоих случаях видит, откуда взялось
предложение, и утверждает сам. Оценка `metered_ai` остаётся верной для будущей
редакции шага, а не для нынешней.

| # | Action | cost_class | Human gate | Output |
|---:|---|---|---|---|
| 1 | link_telegram_identity | free_deterministic | вход в RemHaOS + одноразовый intent | ChannelIdentityLink |
| 2 | bind_project_chat | free_deterministic | `manage_project_integrations` + admin группы | ProjectChannelBinding (active) |
| 3 | ingest_channel_update | free_deterministic | — (системный adapter) | ChannelEvent (+ ChannelAttachment) |
| 4 | extract_candidate | free_deterministic в P0 | — (система ничего не утверждает) | ProjectInboxCandidate (pending) |
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
