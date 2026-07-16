# Wave 3 Agent 2 — Project Brain / Kora report

Дата: 17 июля 2026 года.
Baseline: `4644cc9b8720e439946578a00ab24a579627b563`.
Gate 0 seal: `fa231f5`.

```text
KORA_DB_GOLDEN=true
M2_DECISIONS_SELECTIONS=true
M3_BASELINE_RELEASE=true
CHANGE_IMPACT_GOLDEN=true
NO_ROOM_ONLY_REDUCTION=true
PRODUCTION_CHANGED=false
```

## Результат

Создан pure/application Project Brain слой без direct DB access, migrations, auth,
UI, deploy, commit или push.

### Kora DB-ready golden

Источник:
`tests/project-intelligence/fixtures/pro-up-ru/kora-food-hall-source-manifest.json`.

Generator:
`scripts/project-intelligence/kora/generate-golden.ts`.

Sanitized output:
`fixtures/project-intelligence/kora/kora-project-brain-golden.json`.

Подтверждено:

- 209 physical records;
- 81 materialized physical records с exact 64-hex checksum из source manifest;
- 28 logical SourceRevision: все exact byte aliases одного checksum используют
  одну identity;
- 128 placeholders без checksum и SourceRevision;
- 28 unique materialized blobs;
- 18 duplicate groups;
- 8 semantic-conflict groups;
- статусы `62 current / 17 previous / 120 reference / 10 unknown`;
- UUID Organization/Project/Package/physical record/source revision;
- full-project profile Kora Food Hall, около 1 800 м²;
- ProjectPackage только `project_root | work_package`;
- Floor/Zone/Discipline остаются отдельными graph bindings;
- output не содержит исходных путей и production filenames.

Raw DWG, archive и DOCX могут иметь materialized checksum в inventory, но не
становятся evidence автоматически:

- DWG требует preview;
- archive требует expansion;
- DOCX требует deterministic text extraction;
- semantic conflict требует human review.

Fixture file SHA-256:

```text
579be696eb368db568c18f771a45f35f388f7cef7f1d68167b3f69ce7e5c7d07
```

Semantic fixture hash:

```text
sha256:f441608921c8765f35881ccf33a804e69b034be7a436ec351f7d47657a3f8b2f
```

Повторный generator run даёт тот же file SHA и semantic hash.

### Import planning

`planSourceImport()` фиксирует семь стадий:

1. inventory registration;
2. bytes materialization;
3. checksum/source registration;
4. fragment/evidence extraction;
5. human review;
6. baseline candidate;
7. baseline publication.

Exact-hash aliases получают один logical source ID. Placeholder остаётся только
inventory record. Required semantic conflict блокирует baseline publication до
human resolution.

### M2 Decisions & Selections

Public contracts:

- `RequirementRevision`;
- `AssumptionRevision`;
- `DecisionRevision`;
- `SelectionRevision`;
- `PriceObservation`;
- `ApprovalPackage`;
- `DecisionSelectionPersistencePort`.

Invariants:

- revision immutable и append-only по контракту;
- revision author имеет explicit `human | system` identity;
- sourced extracted/interpreted/unknown revision может быть создана system actor;
- `human_origin` всегда требует human actor;
- non-human claim требует exact source revision/evidence;
- human origin фиксирует human actor;
- изменение требует reason;
- selection привязан к exact Area/Package/DecisionRevision;
- price — non-negative safe integer RUB;
- approval package хранит exact revision IDs;
- approval/reject/request-change выполняется только human review;
- supersession не меняет предыдущую revision.
- публичная `reviseSelectionCandidate()` меняет title/specification/exact
  DecisionRevision binding только через новую revision с reason.

### M3 Baseline, Package и Release

Реализовано:

- package hierarchy validation, включая один root, same scope и cycle rejection;
- completeness and conflict blockers;
- human-approved exact Requirement/Assumption/Decision/Selection revisions;
- immutable `ProjectBaseline`;
- immutable `ProductionPackageVersion`;
- deterministic `ReleaseDescriptor`;
- exact `sha256:` validation;
- same semantic tuple + другой idempotency key возвращает
  `existing_artifact`, а не unique-constraint error;
- explicit human-approved no-change terminal path.
- root package может взять полный baseline; каждый work package обязан передать
  explicit subset и не может сослаться на revision вне baseline.

### Change / impact golden

Executable scenario:

```text
209-record Kora inventory
→ approved Baseline V1
→ immutable ProductionPackageVersion V1
→ one Selection revision change
→ Baseline V2
→ server-derived impact root
→ depth-capped deterministic impact
→ 3 human dispositions
→ immutable ProductionPackageVersion V2
→ deterministic Release V2
```

Demo command:

```text
./node_modules/.bin/tsx scripts/project-intelligence/kora/demo-project-brain.ts
```

Golden demo hashes:

```text
Baseline V1  sha256:d5d10c5933668753f8c1c733caca74d8d4b49e3e8f9adec57481d4537a52d906
Baseline V2  sha256:c80dbe32f680621b153a4b3ffa6f35948d23f2c871460ee5550884fddb8c5f49
Release V2   sha256:9f229b61ef24d4258e174c9b5bad9a700e1bdf367d2b3c8b8f0745ec681d4fd8
```

V1 hash и exact revision refs остаются неизменными после V2.

### Execution hardening

Закрыто pure/application тестами:

- WBS auto-dependencies не пересекают Area/Discipline;
- cross-area dependency возможна только explicit;
- RUB line/total — safe integer, fraction/overflow rejected;
- strict ChangeOrder schema без лишних полей;
- baseline and current DecisionRevision binding;
- controlled ChangeOrder transitions;
- deterministic NFC/line-ending message normalization;
- exact `sha256:` handoff;
- accepted photo per Area и warranty archive requirement;
- impact depth `1..20`.

## Foundation handoff

Typed boundary:

- `lib/project-intelligence/modules/package/foundation-ports.ts`;
- `lib/project-intelligence/modules/decisions/ports.ts`.

Полный запрос к Agent 1:
`docs/product-intelligence/wave-3/agent-2/INTERFACE_REQUESTS_TO_FOUNDATION.md`.

Он выровнен с frozen Foundation names:

- `ingest_source_graph`;
- `get_project_delivery`;
- stable `project_packages`;
- versioned `contractVersion + requestId + data | error`;
- exact Project/Package access scope.

Запрошенные additive persistence surfaces:

- source physical inventory/quarantine;
- Decision/Selection/PriceObservation/ApprovalPackage;
- ProjectBaseline;
- ProductionPackageVersion;
- release artifacts/distributions/acknowledgements;
- changed и explicit no-change terminal records.

## Verification

```text
Scoped Vitest       21/21 PASS
Full Vitest         244/244 PASS
TypeScript strict   PASS
Full ESLint         PASS
Next production build PASS
Generator replay    PASS
git diff --check    PASS
```

Единственное предупреждение — существующий Vite CJS Node API deprecation warning;
оно не связано с Project Brain контрактами.

## Известные ограничения

1. Это application/golden слой. Durable DB transaction, RLS, concurrency,
   restart replay и PG16/PG17 относятся к Agent 1/integration gate.
2. Golden сохраняет exact checksums уже materialized source manifest, но не читает
   production bytes и не утверждает содержимое placeholder.
3. Human reviews в golden являются sanitized deterministic test actors; это не
   production approval.
4. PDF/XLSX/image extraction adapters, renderer, distribution и acknowledgement
   ещё не подключены.
5. Existing local Kora static demo находится вне ownership Agent 2. Новый golden
   не записывался в `public/**` и не содержит real filenames/paths.
6. Production adoption не выполнялась.
