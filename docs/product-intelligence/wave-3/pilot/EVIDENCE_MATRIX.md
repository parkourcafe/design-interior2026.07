# ProjectCEO RU — Kora Pilot Evidence Matrix

Дата: 18 июля 2026 года.

| P0 checkpoint | Fixture / pure evidence | Persistence evidence | UI/browser evidence | Итог |
|---|---|---|---|---|
| Один Kora Project 1 800 м² | pilot fixture, `packageCount=5`, `workPackageCount=4` | Foundation one-org/one-project constraint | server DTO показывает full project | PASS local |
| Source registry | 209 / 81 / 128, 28 blobs, 18 duplicate groups | DB3 ingestion/read | authenticated upload/browser pending | PASS core / browser pending |
| Provenance | interpreted facts используют exact source revision | DB2/DB4 composite evidence checks | DTO redaction pending final live port | PASS core |
| Decisions/Selections | validated immutable revisions V1/V2 | DB4 append-only persistence | route command pending | PASS DB / route pending |
| Human approval | two exact ApprovalPackages approved by human actors | DB4 human RPC/ACL | authenticated action pending | PASS DB / browser pending |
| ProjectBaseline | deterministic V1/V2, V1 unchanged | DB4 immutable baseline | live UI pending | PASS DB / browser pending |
| Work packages | architecture/engineering exact baseline subsets | DB4 package subset FK/checks | guest exact package pending browser | PASS DB / browser pending |
| Release | exact root and architecture release hashes | DB4 release artifact | live worker route pending | PASS DB / route pending |
| Distribution/Ack | exact package version + semantic hash | DB4 distribution/ack persistence | builder/guest browser ack pending | PASS DB / browser pending |
| No-change | explicit human-approved engineering terminal | DB4 no-change persistence | UI action pending | PASS DB / browser pending |
| ChangeRequest | exact baseline V1→V2, reason, +180k RUB, +2 days | DB5 exact lineage; premature release denied | live command pending | PASS DB / route pending |
| Bounded impact | depth 3, 3 deterministic impacts | DB5 max depth/cycle/limit tests | human review screen pending live data | PASS DB / browser pending |
| Human dispositions | 3/3 reviewed | DB5 append-only impact reviews; reviewed release accepted | authenticated architect flow pending | PASS DB / browser pending |
| Photo evidence | 3 accepted areas + 3 accepted photos | DB5 exact materialized source checks | upload/review browser pending | PASS DB / browser pending |
| Milestone acceptance | incomplete closure rejected, complete accepted | DB5 closure constraints | builder/client browser pending | PASS DB / browser pending |
| Handover | warranty required, complete closure accepted | DB5 deterministic immutable handover + restart replay | read projection pending browser | PASS DB / browser pending |
| Cross-role | builder/client/guest capability negatives | DB3–DB5 human/worker ACL split | authenticated role matrix pending | PASS DB / browser pending |
| Cross-package | guest sibling denied, out-of-baseline revision rejected | DB3–DB5 package-scoped negatives | authenticated guest URL pending | PASS DB / browser pending |
| Idempotency/concurrency | deterministic replay object | DB4/DB5 race/replay harness | HTTP replay pending | PASS DB / route pending |
| Sanitized browser roles | exact fixture projections | n/a | owner/architect/builder/client/guest PASS; guest exact package; mobile 390 px clean; no console errors | PASS local / Auth+RLS pending |
| Public asset hygiene | sanitized fixture uses opaque identifiers | n/a | commit `1c803b0` retired raw public manifest; targeted scan clean | PASS local / final artifact scan pending |
| Production isolation | `productionChanged=false` | no production apply | no production deploy | PASS boundary |

## Evidence commands

```bash
zsh tests/projectceo-e2e/run-local.zsh
zsh tests/projectceo-e2e/run-db.zsh
npm run lint
npm run typecheck
npm run test
npm run build
```

Fresh DB5 18 июля: PostgreSQL 16/17 PASS, terminal
`KORA_PILOT_DB_OK pg16=true pg17=true production_changed=false`.

Последние четыре и DB-команды должны выполняться на одном финальном commit. Нельзя
складывать зелёные результаты разных worktree состояний в один release verdict.
