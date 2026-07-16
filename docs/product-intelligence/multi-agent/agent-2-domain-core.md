# ТЗ Agent 2 — Project Graph Domain Core

## 1. Миссия

Завершить и заморозить pure TypeScript-контракт `Project Intelligence Domain v0.1`, который не зависит от Supabase, Next.js, UI, edition, региона или AI-провайдера.

Agent 2 не создаёт persistence, API routes или UI. Его результат должен быть пригоден для использования обоими региональными deployment cells.

## 2. Exclusive write scope

```text
lib/project-intelligence/**
docs/product-intelligence/domain/**
docs/product-intelligence/agent-runs/agent-2/**
```

Запрещено менять:

- `lib/types.ts` и существующие brief/risk/proposal/project-room модули;
- `app/**`;
- `supabase/**`;
- `package.json`, lockfile, configs;
- Agent 1/3 paths;
- общие architecture/ADR документы.

## 3. Входной контракт

До записи файлов дождаться `snapshot_captured: true` в `agent-runs/agent-1/STATUS.md`. Читать документы и составлять внутренний план можно сразу. `BASELINE_READY` ждать не требуется.

Считать принятыми следующие правила:

1. node ID стабилен; revision ID immutable.
2. evidence относится к конкретной revision.
3. `origin` описывает происхождение содержимого revision, а review actor — отдельное измерение. AI-origin revision может быть подтверждена/отклонена человеком; `human_confirmed`/`human_rejected` допустимы только через human action с actor/timestamp и ссылкой на exact revision.
4. dependency edge направлена `dependent → dependency`.
5. change-impact идёт обратно по propagating edges.
6. version diff и impact детерминированы.
7. cross-project edges запрещены.
8. published history не изменяется этим pure модулем.

## 4. Рабочие пакеты

### A2.1 — Audit current public API

1. Перечислить все exports из `index.ts`.
2. Сопоставить их с `project-graph.md` и `vertical-slice-spec.md`.
3. Зафиксировать gaps до изменения кода.
4. Проверить локальные imports/consumers. Если внешних consumers нет, исправить pre-v0.1 модель до freeze и явно перечислить breaking changes; не сохранять двусмысленный compatibility alias.

### A2.2 — Separate stable node, immutable revision and graph snapshot

Текущий `ProjectGraphNode` нельзя оставлять одновременно stable entity и единственной revision. Заморозить явную модель:

- stable node: identity, project, kind, stable key/current revision reference;
- immutable node revision: revision ID, node ID, payload/title, content origin, claim state, replaces revision;
- human review: target revision ID, decision, actor and server timestamp;
- graph snapshot: project ID, exact version ID, nodes/revisions and edge set active для этой версии.

Pure in-memory representation может быть composite snapshot, но public names/types должны однозначно показывать, что stable и revision разделены. Published/input objects не мутируются.

Добавить минимальный `ProjectSource` contract в pure graph, чтобы проверять `SourceFragment.sourceId`: Source, Fragment, Revision и Evidence должны принадлежать одному project; fragment с missing source отклоняется.

### A2.3 — Stable node/revision and provenance

Проверить/обеспечить:

- уникальность stable node IDs;
- уникальность revision IDs;
- evidence link → revision, не просто node;
- source fragment того же project;
- AI claim `extracted/interpreted` требует evidence;
- AI-origin revision сохраняет обязательный evidence и после `human_confirmed`/`human_rejected`;
- `unknown` требует reason;
- human status требует human actor и ISO timestamp;
- AI process/actor не может выполнить human review, но AI-origin revision, подтверждённая реальным человеком, валидна;
- review явно содержит target revision ID и совпадает с текущей подтверждаемой revision;
- duplicate evidence/edge IDs определяются;
- semantic duplicate edge определяется.

Ошибки возвращаются стабильными codes, не только свободным текстом.

Pure validation проверяет структуру review record, но не объявляет actor аутентифицированным: authentication/authorization остаются обязанностью application layer.

### A2.4 — Source locator contract

Добавить discriminated union и runtime validation для минимум:

- PDF: page (1-based), optional normalized bbox;
- transcript/audio: start/end milliseconds, optional speaker;
- image: pixel или normalized bbox с явной coordinate system;
- spreadsheet: sheet + cell range;
- email: message ID + paragraph/part;
- plain text: start/end character offsets.

Validation должна отклонять:

- negative/zero page;
- reversed/out-of-range intervals;
- invalid bbox;
- empty sheet/message ID;
- неизвестный locator kind.

Не добавлять dependency. Использовать TypeScript/manual validation или уже существующий `zod`, только если это не требует package change.

### A2.5 — Claim review transition policy

Создать pure policy/transition API, которое:

- различает system proposal и human action;
- разрешает confirm/reject только human actor;
- сохраняет content origin без изменения: human review AI-origin revision не превращает её origin в `human`;
- создаёт review record, явно привязанный к target revision;
- не позволяет review stale revision, если caller передал другой expected revision;
- не мутирует входной объект;
- возвращает structured success/error result;
- оставляет persistence/audit запись вызывающему слою.

Не реализовывать authentication; принимать уже проверенный actor context.

### A2.6 — Version diff

Проверить/обеспечить:

- added/removed/changed nodes;
- stable JSON Pointer paths;
- независимость от object key order;
- корректный array diff;
- project mismatch rejection;
- duplicate node rejection;
- semantic equality не создаёт false change;
- одинаковый revision ID с разным payload отклоняется как immutability violation;
- разные revision IDs с одинаковым semantic payload дают audit-only transition: content diff пустой и impact root не создаётся;
- output ordering детерминирован.

### A2.7 — Change impact

Проверить/обеспечить:

- allowlist propagating relations;
- non-propagating relations игнорируются;
- shortest deterministic path;
- при двух равных кратчайших paths выбор стабилен и не зависит от порядка input;
- cycles безопасны;
- duplicate roots дедуплицируются;
- missing/cross-project node/edge отклоняется;
- input graph не мутируется;
- каждый impact содержит root, impacted node, distance, node path и edge path.

Caller обязан передать graph/edge snapshot точной целевой версии. Persisted impact ID, lifecycle status и `from/to version` находятся в application/persistence wrapper и не добавляются в pure `ChangeImpact` без отдельного contract decision.

Все сортировки public output используют явный code-point comparator, а не locale-dependent `localeCompare`.

LLM explanations не входят в модуль.

### A2.8 — Contract manifest

Создать:

```text
docs/product-intelligence/domain/contract-v0.1.md
docs/product-intelligence/domain/contract-v0.1.json
```

JSON содержит минимум:

```json
{
  "contractVersion": "0.1",
  "claimStatuses": [],
  "origins": [],
  "nodeKinds": [],
  "relations": [],
  "propagatingRelations": [],
  "locatorKinds": [],
  "errorCodes": [],
  "modelTypes": {
    "stableNode": "",
    "revision": "",
    "humanReview": "",
    "source": "",
    "graphSnapshot": ""
  },
  "ordering": "unicode_code_point",
  "publicExports": []
}
```

Manifest является handoff для Agent 3/Integrator, но не runtime source of truth.

## 5. Test matrix

Минимальные обязательные cases:

| Группа | Cases |
|---|---|
| Identity/provenance | stable node/revision separation; sourced AI valid; unsourced AI invalid before and after human review; evidence to missing revision; duplicate revision/evidence; missing source; cross-project source/fragment; unknown without reason |
| Review | AI-origin revision + human confirm valid; human reject; AI actor confirm denied; review target revision mismatch denied; stale revision denied; content origin unchanged; input unchanged |
| Locator | один valid каждого kind; invalid page; invalid interval; invalid bbox; empty identifiers; unknown kind |
| Diff | changed nested field; added/removed node; key order; array change; duplicate node; project mismatch; same revision/different payload rejected; new revision/same payload audit-only |
| Impact | one-hop; multi-hop; branching; two equal shortest paths; cycle; all eight relation policies; non-propagating; duplicate roots; missing node; cross-project edge; exact version snapshot |
| Determinism | shuffled nodes/edges/roots produce byte-equivalent ordered output; no input object is mutated; non-ASCII IDs do not invoke locale-dependent ordering |

Тест должен проверять exact codes/paths там, где контракт обещает стабильность.

## 6. Validation

Основные команды:

```text
npm test -- lib/project-intelligence
npm run typecheck
eslint lib/project-intelligence --ext .ts
```

Если local checkout недостоверен из-за iCloud:

1. использовать отдельную clean temporary clone;
2. установить dependencies только там;
3. скопировать только owned module;
4. запустить targeted tests/typecheck/lint;
5. явно указать, что это не проверка полного local HEAD.

После targeted green разрешено запустить full `npm test` и `npm run build` в temporary clone. Не устанавливать dependencies в повреждённый working tree.

## 7. Deliverables

- обновлённый `lib/project-intelligence/**`;
- тесты всех обязательных cases;
- `domain/contract-v0.1.md`;
- `domain/contract-v0.1.json`;
- `agent-runs/agent-2/STATUS.md`;
- `agent-runs/agent-2/validation-report.md`;
- при необходимости `CHANGE_REQUEST.md` без изменения чужого файла.

## 8. Acceptance criteria

- module имеет zero imports из `app`, Supabase, UI и edition-specific кода;
- не добавлены dependencies;
- public exports идут через `index.ts`;
- provenance revision-specific;
- stable node, revision, review and versioned graph snapshot are distinct contracts;
- fragment ownership closes through a source in the same project;
- locator и review policies имеют runtime validation;
- diff/impact deterministic and non-mutating;
- обязательная test matrix зелёная;
- typecheck/lint зелёные в достоверной среде;
- manifest соответствует фактическим exports/enums;
- нет изменений вне owned paths.

## 9. Stop conditions

Остановиться и создать `CHANGE_REQUEST.md`, если требуется:

- изменение SQL/schema;
- изменение existing `lib/types.ts`;
- новый package;
- решение о Studio vs Renovation;
- конкретный AI provider;
- UI route/component;
- production data;
- изменение общего ADR.

Не расширять scope, даже если дополнение кажется логичным.

## 10. Handoff contract

В `STATUS.md` добавить:

```yaml
domain_contract_ready: true | false
snapshot_gate_observed: true | false
contract_version: "0.1"
public_api_breaking_changes: []
graph_snapshot_versioned: true | false
source_chain_closed: true | false
required_integrator_adapters: []
targeted_tests: passed | failed
full_tests: passed | failed | not_run
typecheck: passed | failed
lint: passed | failed
```

Agent 3 не меняет свой contract во время параллельной работы. Integrator после завершения сопоставляет fixtures с manifest.
