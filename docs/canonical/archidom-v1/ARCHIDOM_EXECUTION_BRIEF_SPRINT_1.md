> SUPERSEDED_BY_BRAND_RENAME_2026-07-28. CURRENT_BRAND: RemHaOS. Successor package: docs/canonical/remhaos-v1/. Historical content preserved for provenance.

# ARCHIDOM — EXECUTION BRIEF SPRINT 1: PLATFORM FOUNDATION + M1 VERTICAL WORKFLOW

**Версия:** 1.0  
**Дата:** 27 июля 2026  
**Тип задачи:** repository audit + implementation + verification  
**Статус:** EXECUTION-READY  
**Репозиторий:** `parkourcafe/design-interior2026.07`  
**Публичный язык:** русский  
**Язык внутренних отчётов:** русский

## 0. Команда Codex

Выполни спринт `ARCHIDOM PLATFORM FOUNDATION + M1 VERTICAL WORKFLOW`.

Это не просьба написать ещё одну архитектуру. Сначала восстанови фактическое состояние текущего репозитория, затем внеси минимальные production-grade изменения, которые превращают работающий M1 из набора связанных экранов и JSON-полей в первый управляемый vertical workflow поверх общего платформенного фундамента.

Не начинай M2, M3, M4, marketplace, visual workflow builder, CAD/BIM integrations или общий AI-chat.

Не останавливайся после анализа. После repository reconciliation переходи к реализации, тестам и browser QA.

## 1. Нормативные и фактические источники

Используй разделение норм и фактов:

0. `ARCHIDOM_CHARTER_v0.5_CANONICAL.md` — Product Contract. При конфликте по продукту, коммерции, публичным обещаниям, ролям и безопасности действует Charter.
1. Фактический код и migrations production branch — источник факта о текущем состоянии.
2. Реальное production behavior.
3. `CLAUDE.md` для текущего M1.
4. `ARCHIDOM_PLATFORM_ARCHITECTURE_v1.1.md` — Technical Architecture.
5. `BACKLOG.md`.
6. Остальные документы.

Фактическое несовпадение с нормой создаёт gap или OWNER DECISION, но не переписывает норму.

При конфликте не додумывай. Запиши конфликт в Decision Log и выбери минимальное решение, которое не ломает текущий M1 и не публикует будущую функцию как готовую.

## 2. Обязательный Phase 0 — repository reconciliation

До изменения кода:

1. Определи:
   - default branch;
   - production branch;
   - production commit;
   - latest commit;
   - open PRs;
   - незамерженные feature branches;
   - clean/dirty state;
   - deployment configuration.

2. Прочитай полностью:
   - `CLAUDE.md`;
   - `BACKLOG.md`;
   - `package.json`;
   - `next.config.*`;
   - `.env.example`;
   - все Supabase migrations;
   - все server routes;
   - auth middleware;
   - brief, passport, risks, pricing, proposal modules;
   - тесты;
   - существующие audit/SEO reports.

3. Создай:
   - `docs/architecture/ARCHIDOM_REPOSITORY_REALITY_2026-07-27.md`;
   - `docs/architecture/ARCHIDOM_FEATURE_READINESS_MATRIX_2026-07-27.csv`;
   - `docs/architecture/ARCHIDOM_CONFLICT_REGISTER_2026-07-27.csv`.

Статусы:
`LIVE`, `IMPLEMENTED`, `PARTIAL`, `STARTED`, `PLANNED`, `BLOCKED`, `UNKNOWN`.

Ничего не помечай `IMPLEMENTED` только по документации или TODO-комментарию.

## 3. Architecture lock

Добавь в repository docs утверждённую архитектуру без превращения Studio Intelligence в Module 5.

Создай:
- `docs/architecture/ARCHIDOM_PLATFORM_ARCHITECTURE_V1.md`;
- `docs/architecture/ARCHIDOM_DOMAIN_OWNERSHIP_MATRIX_V1.csv`;
- `docs/architecture/ARCHIDOM_AI_ACTION_CONTRACT_V1.md`;
- `docs/architecture/ARCHIDOM_SKILL_CONTRACT_V1.md`;
- `docs/architecture/ARCHIDOM_WORKFLOW_CONTRACT_V1.md`;
- `docs/architecture/ARCHIDOM_EVENT_CATALOG_V1.md`;
- `docs/architecture/ARCHIDOM_PERMISSION_MATRIX_V1.csv`.

Документы должны соответствовать фактическим именам таблиц и кода. Не переписывай существующие working contracts вымышленными сущностями.

## 4. Реализуемый scope

Реализовать первый workflow:

```text
Brief submitted
→ Extract/normalize facts
→ Human review
→ Generate missing questions
→ Build/update Project Passport
→ Generate risk register
→ Build scope draft
→ Calculate fee
→ Generate proposal draft
→ Human approval
→ Issue proposal
```

Допускается использовать существующую реализацию brief/passport/risk/pricing/proposal. Задача не переписать её, а обернуть минимальными общими contracts и сохранённым execution state.

## 5. Минимальная модель данных

Сначала сопоставь с существующими migrations. Вводи новые таблицы только когда существующих полей недостаточно.

Минимально требуется:

### `project_sources`
- id;
- project_id;
- source_type;
- source_ref;
- filename/title;
- checksum при наличии;
- ingested_at;
- created_by.

### `project_facts`
- id;
- project_id;
- fact_type;
- value jsonb;
- source_id;
- evidence_locator;
- status: `extracted|interpreted|unknown|human_confirmed|rejected`;
- confidence;
- created_by_type;
- created_by_id;
- version;
- supersedes_id;
- created_at.

### `workflow_definitions`
- id;
- key;
- version;
- owning_module;
- definition jsonb;
- status.

### `workflow_runs`
- id;
- project_id;
- workflow_key;
- workflow_version;
- status;
- current_step;
- initiated_by;
- input_snapshot;
- output_snapshot;
- error_state;
- started_at;
- completed_at.

### `workflow_step_runs`
- id;
- workflow_run_id;
- step_key;
- status;
- input_snapshot;
- output_snapshot;
- error;
- started_at;
- completed_at.

### `approval_requests`
- id;
- project_id;
- workflow_run_id;
- subject_type;
- subject_id;
- required_role;
- requested_by;
- status;
- decision_by;
- decision_at;
- comment.
- self_approved boolean not null default false.

### `audit_events`
Если существующая `events` достаточна, расширь её совместимо. Иначе введи отдельную таблицу.
Минимум:
- project_id;
- actor;
- event_type;
- entity_type;
- entity_id;
- workflow_run_id;
- payload;
- created_at.

Не создавай пока универсальную graph database. Project Graph v1 реализуется через типизированные relational entities и foreign keys.

### `ai_calls`
- id;
- project_id;
- workflow_run_id;
- workflow_step_run_id;
- action_key;
- cost_class: `free_deterministic|metered_ai|external_paid`;
- provider_key;
- model_key;
- tokens_in;
- tokens_out;
- provider_cost_estimate numeric — оценка в рублях на момент вызова;
- estimate_source: `static_table|provider_response`;
- duration_ms;
- outcome: `success|schema_fail|provider_error|timeout`;
- retry_of_id;
- created_at.

Измерение стоимости обязательно; пользовательский billing и credit balance не входят в Sprint 1.

## 6. Backward compatibility

Обязательно:
- текущие проекты открываются;
- brief links продолжают работать;
- существующие answers не теряются;
- `projects.passport` сохраняется как совместимый read model;
- risk cards продолжают отображаться;
- pricing остаётся deterministic;
- proposal tokens продолжают работать;
- текущая auth/RLS модель не ослабляется.

Миграции должны иметь rollback notes и не удалять существующие поля в этом спринте.

## 7. AI safety and write policy

AI не может напрямую подтверждать факты или выпускать proposal.

Правила:
1. Каждый AI output проходит schema validation.
2. Каждый извлечённый факт имеет source и evidence locator.
3. AI создаёт `extracted` или `interpreted`, но не `human_confirmed`.
4. Изменение подтверждённого факта создаёт новую version/supersedes relation.
5. Proposal issue требует human approval.
6. Ошибка LLM не ломает workflow; step получает failed/retryable status.
7. Все tool/model calls сохраняются без секретов и без лишней PII.
8. PII masking сохраняется.
9. Никакие новые западные LLM providers не подключать.

## 8. Skills и Actions

Не строить marketplace и UI-конструктор.

Создать внутренний registry в коде для M1 actions:
- `extract_client_brief`;
- `generate_clarifying_questions`;
- `build_project_passport`;
- `generate_risk_register`;
- `build_scope_draft`;
- `calculate_fee`;
- `generate_proposal_draft`;
- `issue_proposal`.

Каждое действие должно иметь:
- input schema;
- output schema;
- allowed roles;
- allowed reads;
- permitted writes;
- approval requirement;
- audit event names;
- version;
- cost_class: `free_deterministic|metered_ai|external_paid`.

Классификация:

| Action | cost_class |
|---|---|
| extract_client_brief | metered_ai |
| generate_clarifying_questions | metered_ai |
| generate_risk_register | metered_ai для LLM-части |
| generate_proposal_draft | metered_ai |
| build_project_passport | free_deterministic |
| build_scope_draft | free_deterministic до появления LLM |
| calculate_fee | free_deterministic |
| issue_proposal | free_deterministic |

Существующую бизнес-логику переиспользовать через adapters.

## 9. Workflow UX

Не добавляй огромный раздел AI.

В текущем project/review flow добавь:
- статус процесса;
- текущий шаг;
- completed/pending/blocked/failed;
- кнопку следующего допустимого action;
- source/evidence view для фактов;
- human review screen;
- retry для failed AI step;
- workflow history.

Отдельный `/automations` или settings builder в этом спринте не требуется.

## 10. Studio Memory v0

Не строить полный Studio Intelligence.

Разрешено нормализовать уже существующие:
- pricing;
- proposal defaults;
- studio name;
- базовые document defaults.

Добавить единый server-side resolver:

```text
specific approved project value
> project override
> studio default
> platform default
```

Покрыть precedence unit tests. Resolver обязан сохранять ссылку на версию StudioStandard. Изменение стандарта не переписывает approved values; будущая система создаёт `standard_drift` event.

Brand assets, workflow builder, skills marketplace, integrations и design system оставить в backlog.

## 11. RLS и permissions

Добавь и протестируй RLS для новых таблиц.

Проверить:
- дизайнер не читает чужой проект;
- public intake token не получает прямой доступ к project facts;
- service role используется только в server routes;
- client/public token видит только разрешённый read model;
- approval может принять только требуемая роль;
- site/architect roles пока не получают фиктивных прав;
- audit events нельзя подменить обычным клиентом.

## 12. Tests

Добавить:

### Unit
- fact status transitions;
- version/supersedes logic;
- studio/project precedence;
- action contracts;
- workflow state transitions;
- retry policy;
- approval gate;
- deterministic pricing regression;
- passport backward compatibility.

### Integration
- brief submit creates/updates workflow run;
- fact extraction stores provenance;
- human confirmation changes status;
- passport rebuild uses confirmed values correctly;
- risk generation does not overwrite accepted cards silently;
- proposal issue blocked without approval;
- workflow resumes after retry;
- RLS isolation.

### Regression
- existing M1 happy path;
- public brief;
- Review Board;
- proposal public token;
- auth/protected routes;
- PII masking;
- rate limits.

## 13. Browser QA

Проверить desktop и mobile:

1. Создание проекта.
2. Создание/копирование brief link.
3. Клиент проходит brief.
4. Designer видит workflow status.
5. Designer проверяет факты и источники.
6. Designer подтверждает/отклоняет.
7. Passport обновляется.
8. Risks создаются и review работает.
9. Pricing рассчитывается.
10. Proposal draft создаётся.
11. Выпуск заблокирован без approval.
12. После approval proposal доступен по token.
13. Retry failed step.
14. Existing project migration/read compatibility.
15. Console/network errors отсутствуют.

## 14. Не делать

- Module 2, 3 или 4 UI.
- Module 5.
- Visual workflow builder.
- Skills marketplace.
- Chat-centric UI.
- Google Drive/Gmail/CAD integrations.
- MCP server.
- CRM.
- Accounting.
- Billing.
- Marketplace/lead matching.
- Auto-approval.
- Silent overwrite.
- Graph database.
- Массовый refactor ради новой терминологии.
- SEO expansion pages.

## 15. Required reports

Создать:

1. `docs/reports/ARCHIDOM_PLATFORM_FOUNDATION_EXECUTION_2026-07-27.md`
2. `docs/reports/ARCHIDOM_M1_VERTICAL_WORKFLOW_QA_2026-07-27.md`
3. `docs/reports/ARCHIDOM_MIGRATION_AND_ROLLBACK_2026-07-27.md`
4. `docs/reports/ARCHIDOM_SECURITY_PROOF_2026-07-27.md`

Каждый отчёт:
- EXTRACTED;
- INTERPRETED;
- IMPLEMENTED;
- BLOCKED;
- exact files changed;
- migrations;
- commands;
- tests;
- browser evidence;
- unresolved risks;
- rollback;
- commit SHA.

## 16. Acceptance criteria

Спринт завершён только если:

1. Фактическая readiness matrix создана из кода.
2. M1 не сломан.
3. Один workflow run сохраняется и возобновляется.
4. Каждый новый AI fact имеет provenance.
5. AI не создаёт `human_confirmed`.
6. Каждый metered_ai вызов записан в `ai_calls` с tokens и provider_cost_estimate; отчёт содержит себестоимость полного прохода brief → issued proposal.
7. Self approval маркируется `self_approved=true` и не называется независимой проверкой.
8. Proposal нельзя выпустить без approval.
9. Existing passport остаётся совместимым.
10. Новые таблицы защищены RLS.
11. Unit/integration/regression tests проходят.
12. Typecheck, lint и production build проходят.
13. Desktop/mobile QA проходит.
14. Документация соответствует коду.
15. Не создан Module 5.
16. Не реализованы будущие модули под видом готовых.
17. Production/public claims не расширены.
18. Entity mapping соответствует `ARCHIDOM_ENTITY_CATALOG_v1.md`.
19. Decision и workflow state machines покрыты tests.

## 17. Final verdict

Заверши отчёт двумя независимыми статусами:

```text
REPOSITORY_REALITY: RECONCILED | NOT_RECONCILED | BLOCKED
M1_VERTICAL_WORKFLOW: READY | PARTIAL | NOT_READY | BLOCKED
PLATFORM_FOUNDATION: READY_FOR_M2 | NOT_READY_FOR_M2 | BLOCKED
PUBLIC_SCALE: GO | CONDITIONAL | NO_GO
CHARTER_14_3_PILOT_SLICE: 2/10 STEPS | <N>/10 STEPS | COMPLETE
```

Если тесты, RLS или production branch не доказаны, не ставь READY.

## 18. State machines

Decision:

```text
draft → in_review → approved → superseded → archived
                 ↘ rejected
```

WorkflowRun:

```text
queued → running → waiting_for_human | pending_cost_confirmation | retrying
       → completed | failed | cancelled | rolled_back
```

Переходы вне контракта запрещены и тестируются.
