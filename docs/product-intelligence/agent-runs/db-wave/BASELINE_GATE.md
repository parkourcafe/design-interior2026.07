# Project Intelligence DB wave — materialization gate

Дата проверки: 16 июля 2026 года.

## Решение

```text
MATERIALIZED_GIT_BASELINE=true
REPRODUCIBLE_CANONICAL_DIRTY_STATE=true
LOCAL_SNAPSHOT_GATE_PASSED=true
REMOTE_REF_RECONCILED=true
CANDIDATE_MIGRATION_CHAIN_BYTES=available
AUTHORITATIVE_PRODUCTION_MIGRATION_LEDGER=true

DB1_DESIGN_REVIEW_ALLOWED=true
DB1_ACCEPTED=true
DB2_LOCAL_ALLOWED=true
DB2_PRODUCTION_ALLOWED=false
PRODUCTION_APPLY_ALLOWED=false
```

Локальная materialization-часть gate пройдена: Git, pack, index и рабочие файлы
читаются, dirty state зафиксирован до дальнейших изменений и сохранён в проверенном
snapshot. Формальный DB1 review теперь разрешён.

После первоначального snapshot-gate получен authoritative production schema snapshot.
Его migration ledger достоверно пуст, а schema reconciled с exact legacy migration
bytes. Поэтому DB1 закрыт для локальной additive разработки. Production apply остаётся
закрыт.

## Canonical checkout

```text
Path:   /Users/msnigmatullaeva/Documents/designinterior2026/repo
Branch: claude/arhidom-cinematic-website-t2zfdc
HEAD:   5134998def61dae3a7fcf8edb96559d22b9d0845
Tree:   cf8a2b9602aa6a797916fa92350892363bed2e81
Parent: 08116069cadda667e5527e8336d898365ae81887
```

Materialized state:

- `.git/index`: 20,035 B, читается, flag `dataless` отсутствует;
- required pack: 506,751 B, читается, flag `dataless` отсутствует;
- `dataless=0` для `.git` и migration scope;
- `git fsck --full --strict` успешен; найдены только четыре dangling blob;
- staged files: `0`;
- tracked unstaged files: `13` (`10 modified`, `3 deleted`);
- non-ignored untracked files: `252`;
- `0007_project_rooms.sql` удалён только в worktree, но сохранён в HEAD и snapshot;
- `0008_concept_packs.sql` совпадает с HEAD;
- `0009_project_room_workflow.sql` остаётся untracked candidate без Git ancestry.

До materialization выполнялись только non-destructive iCloud download requests.
Placeholder не удалялся и не перезаписывался.

## Captured dirty-state snapshot

Проверенный snapshot сохранён в постоянной папке:

```text
/Users/msnigmatullaeva/Documents/designinterior2026/snapshots/pi-snapshot-gate-20260716T064907Z
```

Он содержит raw Git index, refs archive, complete-history bundle, staged/unstaged binary
diff, NUL-safe status/manifests, все 252 untracked файла, migration hashes и checksums.

```text
git-index.bin:          f4626a92e8760a2f22d3ebe897ce46df8bd43a9e441a6532cebe00de7b4d6966
git-history.bundle:     fe4765b61efc837e450d30bd9a760b2127d325bcae646992ad15c819b952cc29
unstaged.binary.diff:   40c69ceca85e8bb6006460cc542d6ef4fd59b3c82f606d9daa809edb3c2d8e6f
untracked.sha256 pairs: b7b51e32ae4525101319edd5919a6d8dd99b3b61bc2c6c424ac1a654179f6d67
durable checksum list:  4154d8f0a7bdfc0146dff7c38c731a9e965750f81b3093a56dd96b11acdcf1ad
```

`git bundle verify`, directory comparison и checksum verification успешны.

## Remote reconciliation

Actual remote ref проверен read-only и сопоставлен с локальным snapshot в disposable
checkout:

```text
Local HEAD:       5134998def61dae3a7fcf8edb96559d22b9d0845
Actual remote:    96e895d9f25fbe1f17ee7b54195bd189f07d0ced
Common ancestor:  19aa41f1e9c30da9c0d3bbdbde193ee66b1185c9
Relationship:     diverged; neither ref is ancestor of the other
```

Remote-линия не содержит `0007/0008`; локальная линия добавила их коммитом `492c3d6`.
Canonical checkout не fetch/reset/merge и не изменял refs.

## Materialized reconstruction candidate

Для проверки байтов, не для замены canonical checkout, создана локальная среда:

```text
Path:        /private/tmp/pi-db-wave-baseline
Remote base: 96e895d9f25fbe1f17ee7b54195bd189f07d0ced
Remote head: 96e895d9f25fbe1f17ee7b54195bd189f07d0ced
```

Composition candidate:

```text
remote tracked tree at 96e895d
+ accepted Project Intelligence Wave 1/Wave 2 overlay
+ exact local-HEAD 0007
+ exact local-HEAD 0008
+ canonical worktree-only 0009
```

130 входных файлов зафиксированы в `baseline-manifest.json`:

```text
Manifest schema:    project-intelligence-db-baseline/1.0
File count:         130
Aggregate SHA-256:  6e8ba52d53bd5f797218eb96794ed0e944cb71eb1f5900e34a60a91db092ec0f
```

Этот historical reconstruction candidate сохраняется как cross-check. После
materialization authoritative local ancestry и dirty state берутся из canonical checkout
и captured snapshot.

## Candidate migration chain

| Migration | Source | Size | SHA-256 |
|---|---|---:|---|
| `0001_init.sql` | remote/local HEAD equal blob | 8,349 | `d5b9015014ca53d257967b9813a6c2bad664c2e9c69944a6dd92ae648c98625a` |
| `0002_client_briefs.sql` | remote/local HEAD equal blob | 1,192 | `6ac83d72419a786a951a6887f30bdc592d8b760de016278d5338f896ad98b946` |
| `0003_custom_questions.sql` | remote/local HEAD equal blob | 917 | `e2b9b43456ea8827c1a81c3e7172d427be6827d76dad06b28e1381e2e580de81` |
| `0004_designer_profile.sql` | materialized canonical | 681 | `823b2f2db7ff590027a058387cda4e0b3f636121ca2121310d40ee02e5233c65` |
| `0005_rate_limits.sql` | materialized canonical | 1,732 | `d4e32ed66f606abf3537d3ada9ff61a3673c89602e4399be398ea27ca7187af2` |
| `0006_team.sql` | remote/local HEAD equal blob | 6,243 | `2b56b060b70ae32683d9325de6991447b7530c9cc310842c215753cb4ab6efee` |
| `0007_project_rooms.sql` | exact local-HEAD blob/proposal | 6,164 | `474f49491d60bbb200f8f1723a500b3f2c3b7fe0c4769d5507544c07e73a12cc` |
| `0008_concept_packs.sql` | exact local-HEAD blob extraction | 3,383 | `530a166c4ae5f05b3e43aecba52c1dae4b59f8b1c46a9a771de4d48a84ad1433` |
| `0009_project_room_workflow.sql` | materialized worktree-only candidate | 12,037 | `3b6c8623aaa758336434435ddb00cde52f8ab9f223780cfd95080a0491bcaf26` |

Candidate-chain aggregate over sorted `hash + path` lines:

```text
8595447832d2fde459032de02f86e277b79c93a3154215bc6bee0d71acc13ddb
```

Exact `0008` additionally сохранён как non-executable evidence
`recovered-evidence/0008_concept_packs.sql.txt`. Его hash равен local-HEAD blob hash.

## Migration root decision

- authoritative production ledger: empty;
- production structurally contains `0001–0004`, `0006` and schema-equivalent `0007`;
- production lacks `0005`, `0008` and `0009`;
- current `0009` is rejected permanently as executable;
- legacy numeric files become non-executable historical evidence;
- active chain starts with a new timestamped production-adoption baseline;
- additive Project Intelligence migrations follow that timestamp.

The adoption baseline is never executed over the existing production schema. It is
bootstrapped only on disposable databases; production history adoption requires a
separate approval.

## Conditions to pass

Завершено:

1. Materialize `.git`, tracked files и migrations; `dataless=0`.
2. Сохранить raw index, refs, complete Git bundle, binary diffs и untracked content.
3. Получить успешные `git status`, `git diff`, `git diff --cached`, `git fsck`.
4. Сверить actual remote ref в отдельном disposable checkout.

Завершено после первоначальной фиксации:

1. Получен approved read-only production schema/ledger snapshot.
2. Production reconciled с exact `0001…0009`.
3. Проверен private Storage bucket `client-uploads`.
4. Зафиксирована logical classification `ru/studio`.
5. Текущий `0009` отклонён как executable.

Осталось до production rollout:

1. Проверить adoption baseline на clean PostgreSQL `17.6`.
2. Пройти DB2 disposable RLS/concurrency/idempotency harness.
3. Провести отдельный production security/hardening review.
4. Получить отдельное production approval на migration-history adoption и rollout.

## Explicit boundary statements

```text
Canonical placeholders overwritten: NO
Git index/refs changed: NO
Git fetch/reset/checkout/restore performed: NO
External snapshot captured: YES
Disposable ref comparison created: YES
Production data/PII read: NO
Production schema/ledger changed: NO
Database migration applied: NO
supabase/migrations changed: NO
Deployment performed: NO
```
