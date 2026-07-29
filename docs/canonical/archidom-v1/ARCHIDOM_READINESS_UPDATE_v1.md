> SUPERSEDED_BY_BRAND_RENAME_2026-07-28. CURRENT_BRAND: RemhaOS. Successor package: docs/canonical/remhaos-v1/. Historical content preserved for provenance.

# ARCHIDOM — REPOSITORY READINESS AUDIT · Canonical Update

**Дата:** 27.07.2026  
**Класс:** Readiness Update  
**Основание:** доступные repository files, история commits, предыдущий audit и Addendum A1.  
**Ограничение:** полный checkout, migrations, tests и production browser pass должен выполнить Phase 0 Codex. Документальные утверждения не считаются доказательством кода.

## 1. Evidence levels

- `CODE_REPORTED` — найдено в repository file или commit history, но не запущено в этой проверке.
- `DOC_TARGET` — утверждено в Charter/Architecture, но не доказано кодом.
- `TEST_PROVEN` — подтверждено passing test с evidence.
- `PRODUCTION_PROVEN` — подтверждено production behavior с evidence.
- `UNKNOWN` — доказательств недостаточно.

Процентные баллы отменены: они создавали точность без рубрики.

## 2. Current verdict

```text
M1_WORKING_SKELETON: PARTIAL
PLATFORM_FOUNDATION: NOT_READY
STUDIO_MEMORY: EARLY_FRAGMENT
M2: NOT_PROVEN
M3: NOT_PROVEN
M4: TARGET_ONLY
REPOSITORY_REALITY: NOT_RECONCILED
PUBLIC_SCALE: BLOCKED
```

## 3. CODE_REPORTED

По доступному `CLAUDE.md`, backlog и commit history заявлены:

- публичный quick brief;
- deterministic passport builder;
- hybrid risk rules + LLM;
- risk review;
- deterministic pricing;
- proposal versions и public token;
- Supabase Auth, Storage, RLS architecture;
- provider abstraction;
- Zod validation, repair retry, fallback;
- PII masking;
- rate-limit infrastructure;
- русская локализация и рубли;
- public routes `/designers`, `/studios`, `/security`, `/pilot`, legal, demo и proposal;
- PWA/store preparation;
- auth/protected routes hardening в истории commits.

Эти пункты остаются `CODE_REPORTED`, пока Phase 0 не даст exact file paths, migrations, tests и browser evidence.

## 4. DOC_TARGET

Утверждены, но не доказаны реализацией:

- общий Project Graph;
- normalized project_facts с provenance;
- Decision lifecycle;
- Workflow Engine и persisted runs;
- Action/Skill Registry;
- reusable Approval Gate;
- ai_calls и cost instrumentation;
- StudioStandard versioning и standard_drift;
- Integration Gateway;
- Design System;
- общий Version/Document Engine;
- M2, M3 и M4 workflows;
- Evidence Pack.

Target Architecture M4 не смешивается с CODE_REPORTED.

## 5. Partially present

- Project Memory: passport, answers, risk cards, proposals и events дают ранний M1 read model.
- Versioning: proposal version существует по документации; общий version engine не доказан.
- Approvals: risk review и proposal response существуют по документации; общий approval contract отсутствует.
- Events: таблица events заявлена; Project Event Bus не доказан.
- Studio defaults: pricing и proposal_defaults — ранний fragment, не Studio Memory.
- Documents: proposal print/public flow — не общий rendering engine.

## 6. Confirmed conflicts for Phase 0

1. Default branch и production branch должны быть установлены фактически.
2. Production audit ссылался на более поздний commit, чем последний commit в доступной основной истории.
3. Backlog относит Concept Pack, Specs Engine, portal и integrations к будущему.
4. Public claims не должны опережать Studio Memory и M2–M4.
5. Target architecture шире текущей M1 schema.
6. Charter v0.4 содержал временное предположение о параллельном старте M2/M3; v0.5 не считает их готовыми без repository proof.

## 7. Critical gaps

1. Нет доказанного сквозного контракта `Source → Fact → Decision → Deliverable → Version → Impact`.
2. Нет governed AI execution с persisted run, cost, permitted writes и human gates.
3. Нет единого доказанного repository reality report.

## 8. Next allowed action

Разрешён только Sprint 1 Platform Foundation + M1 Vertical Workflow. Он не открывает M2–M4 и не закрывает полный Charter Pilot Slice.
