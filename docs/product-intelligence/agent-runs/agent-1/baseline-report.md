# Repository and migration baseline — 2026-07-16

## Decision

```text
BASELINE_READY=false
```

Pure domain/docs work may continue in isolated owned paths. Persistence work, edits to existing application files, production migrations, and Git integration remain blocked.

## What is trustworthy

- Gate 0 captured every existing Agent 2/3 writable-scope file by path, metadata, and SHA-256. Scope hash: `6d6d82221ed157e3f8248af14ad4b6c72573801e454b15ed466658a39577f218`; unreadable files in that scope: zero.
- Local branch ref and commit are readable: `claude/arhidom-cinematic-website-t2zfdc` at `5134998def61dae3a7fcf8edb96559d22b9d0845`.
- Current upstream branch hash was independently read without changing refs: `96e895d9f25fbe1f17ee7b54195bd189f07d0ced`.
- The local HEAD tree proves migrations `0001…0008` existed at that commit. Verified content was recovered for all of them; `0001…0006` match upstream Git blob IDs, and `0007/0008` were readable as local loose blobs.
- Exact local-HEAD `0007` is preserved only as an Agent 1 proposal with SHA-256 `474f49491d60bbb200f8f1723a500b3f2c3b7fe0c4769d5507544c07e73a12cc`.
- The proposed continuous `0001…0009` chain passed a clean, local-only PostgreSQL 16 bootstrap and schema assertions.
- Production Data API metadata independently reconfirmed the basic `0007` shape and absence of the `0009` hardening shape.

## Blocking conditions

1. **Git metadata is unavailable.** Sixty-two Git files are `dataless`, including `.git/index` and the required packfile. `git status`, both diffs, and `git fsck` exit `138`.
2. **Source/config state is unavailable.** Seventy-six non-generated source/config candidates are `dataless`. Because the index is unavailable, their tracked/untracked classification is also unknown.
3. **Dirty state is unknown.** Staged, unstaged, and non-ignored untracked files cannot be enumerated. A fresh clone cannot safely replace this working tree.
4. **The actual worktree migration chain is broken.** `0007_project_rooms.sql` is missing; `0008_concept_packs.sql` is dataless/unhashed; `0009` directly alters objects created by `0007`.
5. **The authoritative production migration ledger was not obtained.** PostgREST returned `406` for the `supabase_migrations` profile, and no read-only Management/direct-PostgreSQL credential is available.
6. **Security blockers remain.** The generic task-status RPC trusts actor role/participant input, public grants are plaintext/non-expiring, task audit rows are mutable, and deployment grants are not explicit. See `security-review.md`.

Two explicit `brctl download` request cycles were sent for Git metadata and source/config candidates. Counts and flags did not change. No placeholder was overwritten, deleted, or replaced.

## Acceptance criteria evaluation

| Criterion | Result |
|---|---|
| tracked source/config and Git metadata fully materialized | failed |
| `git status`, `log`, `diff` free of corruption errors | failed (`log` is partial and emits pack errors) |
| dirty/staged/untracked state preserved and reported | unavailable; only Agent 2/3 scope snapshot succeeded |
| authoritative migration ledger obtained | failed |
| ledger reconciled with schema-only evidence | not possible |
| proposed continuous `0001…0009` assembled | passed |
| clean local bootstrap | passed |
| production unchanged | passed |
| Agent 1 stayed within write ownership | passed |

Because every criterion is mandatory, bootstrap success cannot turn the overall decision true.

## Exact baseline refs

- local HEAD: `5134998def61dae3a7fcf8edb96559d22b9d0845`;
- locally stored upstream ref: `19aa41f1e9c30da9c0d3bbdbde193ee66b1185c9` (stale);
- current upstream ref from `ls-remote`: `96e895d9f25fbe1f17ee7b54195bd189f07d0ced`;
- worktree Git status: unknown;
- migration ledger: unknown.

No ancestry/divergence conclusion is made: the local object store is incomplete, and the separately readable upstream snapshot is not the local baseline.

## Next safe step

1. Make the existing repository fully local through iCloud “Download Now/Keep Downloaded” or an equivalent non-destructive materialization; confirm `dataless` is zero for `.git` and source/config files.
2. Re-run Git integrity before any fetch, index repair, checkout, restore, or reset. Capture porcelain-v2 status and binary staged/unstaged diffs once readable.
3. Obtain approved read-only Supabase Management/direct-PostgreSQL access and read `supabase_migrations.schema_migrations` plus a schema-only dump.
4. Let the Integrator compare the exact proposed `0007`, local-HEAD `0008`, and worktree `0009` against recovered Git and ledger evidence.
5. Address blocking security findings before exposing the task RPC or new public grant model.

Until steps 1–4 succeed, `database_changes_allowed_next_wave=false`.
