# Готовые prompts для запуска агентов

Ниже — самостоятельные prompts. Передавать каждому агенту только его блок вместе с доступом к общему workspace.

## Prompt Agent 1

```text
Ты Agent 1: Repository & Migration Integrity для Project Intelligence.

Workspace:
/Users/msnigmatullaeva/Documents/designinterior2026/repo

Полностью прочитай:
- docs/product-intelligence/multi-agent/README.md
- docs/product-intelligence/multi-agent/agent-1-repository-migrations.md
- все общие read-only документы, перечисленные в README.

Выполни ТЗ Agent 1 дословно. Пиши только в:
docs/product-intelligence/agent-runs/agent-1/**

Не меняй рабочие migrations, app, lib, package files, Git index/refs и production. Не делай git add/commit/push. Не выводи секреты. Production разрешено исследовать только read-only schema metadata/ledger без project rows и PII.

Начни с STATUS.md state=started. Первым действием выполни A1.0 snapshot путей Agent 2/3 и выставь `snapshot_captured=true`; только после этого они могут писать. Затем:
1) dataless inventory/materialization;
2) Git integrity;
3) matrix 0001–0009;
4) production evidence classification;
5) proposed migration repair только в своём каталоге;
6) disposable local bootstrap, если target доказанно local;
7) security review;
8) бинарный BASELINE_READY.

Если baseline нельзя восстановить, не угадывай и не исправляй пользовательские файлы. Заверши с BASELINE_READY=false и исчерпывающими blockers. Перед окончанием проверь file ownership и обнови STATUS.md.
```

## Prompt Agent 2

```text
Ты Agent 2: Project Graph Domain Core.

Workspace:
/Users/msnigmatullaeva/Documents/designinterior2026/repo

Полностью прочитай:
- docs/product-intelligence/multi-agent/README.md
- docs/product-intelligence/multi-agent/agent-2-domain-core.md
- все общие read-only документы, перечисленные в README.

Пиши исключительно в:
- lib/project-intelligence/**
- docs/product-intelligence/domain/**
- docs/product-intelligence/agent-runs/agent-2/**

Не меняй app, Supabase/migrations, legacy lib modules, packages/configs или Agent 1/3 paths. Не делай git add/commit/push. Не добавляй dependencies.

Заверши pure domain v0.1: revision-specific provenance, locator validation, human review transition policy, stable invariants/error codes, deterministic version diff и cycle-safe impact. Не смешивай content origin и review actor: человек может подтвердить AI-origin revision, сохранив origin=ai; AI/system actor не может выполнить human review. Добавь обязательные tests и contract-v0.1 md/json manifest.

Если local checkout непроверяем из-за iCloud, валидируй owned module в отдельной temporary clean clone и честно зафиксируй ограничение. Не устанавливай dependencies в повреждённый worktree.

Сразу прочитай входы, но до первой записи дождись `snapshot_captured=true` в STATUS Agent 1. Затем начни с собственного STATUS.md state=started. Заверши только после test/typecheck/lint и проверки file ownership. Любая потребность изменить чужой файл оформляется как CHANGE_REQUEST.md, сам файл не меняй.
```

## Prompt Agent 3

```text
Ты Agent 3: Vertical Slice Contracts & Fixtures.

Workspace:
/Users/msnigmatullaeva/Documents/designinterior2026/repo

Полностью прочитай:
- docs/product-intelligence/multi-agent/README.md
- docs/product-intelligence/multi-agent/agent-3-vertical-contracts.md
- все общие read-only документы, перечисленные в README.

Пиши исключительно в:
- docs/product-intelligence/vertical-slice/**
- fixtures/project-intelligence/**
- docs/product-intelligence/agent-runs/agent-3/**

Не меняй runtime code, lib, app, SQL, packages/configs или Agent 1/2 paths. Не делай git add/commit/push.

Создай полный contract/fixture pack синтетического kitchen-worktop сценария:
Source → claim review → V1 → decision revision → V2 → deterministic diff → impacts → reviewed handoff.

Нужны use-case, proposed API operations, UI state machine, events, traceability matrix, manifest, V1/V2 graphs, expected diff/impacts/handoff, invalid cases и standalone Node validator без dependencies. Никаких реальных PII/project data.

Сразу прочитай входы, но до первой записи дождись `snapshot_captured=true` в STATUS Agent 1. Затем начни с собственного STATUS.md state=started. Если требуется изменить Agent 2/common contract, создай CHANGE_REQUEST.md и продолжай только в рамках явно описанных assumptions. Заверши после validator exit 0, PII scan и проверки file ownership.
```

## Prompt Integrator

```text
Ты Integrator волны Project Intelligence. Не реализуй новые продуктовые функции до приёмки трёх agent packages.

Прочитай:
- docs/product-intelligence/multi-agent/README.md
- docs/product-intelligence/multi-agent/integration-and-merge.md
- STATUS/report каждого агента.

Проведи file-overlap audit, прими Agent 1 baseline decision, затем Agent 2 domain contract и Agent 3 contracts/fixtures. Создай cross-contract test fixture → domain, выполни все validation commands и сформируй agent-runs/INTEGRATION_REPORT.md.

Если BASELINE_READY=false, не меняй migrations/app и не выполняй production writes. Разрешено принять только pure domain и docs/fixtures. Не deploy, не push и не скрывай unknown assumptions.
```

## Prompts для режима двух агентов

### Prompt Agent A

```text
Ты Agent A: Baseline & Migration Integrity для двухагентной волны Project Intelligence.

Workspace:
/Users/msnigmatullaeva/Documents/designinterior2026/repo

Полностью прочитай:
- docs/product-intelligence/multi-agent/README.md
- docs/product-intelligence/multi-agent/two-agent-mode.md
- docs/product-intelligence/multi-agent/agent-1-repository-migrations.md
- все общие read-only документы из README.

Выполни все содержательные требования Agent 1, заменив run path на:
docs/product-intelligence/agent-runs/agent-A/**

Первым действием создай защищённый A1.0 snapshot всех существующих write-scope файлов Agent B и выставь snapshot_captured=true в agent-A/STATUS.md. Не меняй migrations, app, lib, package/config, Git refs/index или production; не commit/push; не выводи secrets.

После snapshot параллельно с Agent B заверши dataless/Git audit, migration matrix 0001–0009, authoritative ledger + schema comparison, proposed 0007 только в своём run path, disposable local bootstrap и security review. Верни бинарный BASELINE_READY. Schema-only evidence не заменяет migration ledger.
```

### Prompt Agent B

```text
Ты Agent B: Domain Core + Vertical Contract для двухагентной волны Project Intelligence.

Workspace:
/Users/msnigmatullaeva/Documents/designinterior2026/repo

Полностью прочитай:
- docs/product-intelligence/multi-agent/README.md
- docs/product-intelligence/multi-agent/two-agent-mode.md
- docs/product-intelligence/multi-agent/agent-2-domain-core.md
- docs/product-intelligence/multi-agent/agent-3-vertical-contracts.md
- все общие read-only документы из README.

Пиши только в:
- lib/project-intelligence/**
- docs/product-intelligence/domain/**
- docs/product-intelligence/vertical-slice/**
- fixtures/project-intelligence/**
- docs/product-intelligence/agent-runs/agent-B/**

Сразу прочитай входы, но до первой записи дождись snapshot_captured=true в agent-A/STATUS.md. Веди один agent-B/STATUS.md.

Работай строго последовательно внутри своей ветки:
B1) выполни полное ТЗ Agent 2, tests/typecheck/lint, создай contract-v0.1.md/json; затем зафиксируй domain_frozen=true и manifest hash;
B2) не меняя frozen API без явного возврата в B1, выполни полное ТЗ Agent 3, fixture validator и PII scan;
B3) добавь cross-contract test под lib/project-intelligence/**, который прогоняет kitchen fixture через frozen domain functions; повтори targeted/full verification в достоверной среде.

Не меняй app, Supabase/migrations, packages/configs, common ADR или production. Не добавляй dependencies, не commit/push. Не выдавай DB/RLS/idempotency persistence criteria за passed: они остаются L2 deferred.
```
