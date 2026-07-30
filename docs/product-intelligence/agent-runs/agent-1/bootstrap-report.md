# Clean bootstrap report

## Outcome

`bootstrap=passed` for the proposed continuous `0001…0009` chain on a disposable local PostgreSQL 16 database.

The target was an unlinked Docker container with no published host port. The container was removed automatically after the run. No Supabase project, remote database, or production endpoint was used.

## Environment

- image: already-local `postgres:16-alpine` with `--pull=never`;
- safe target label printed before migration: `container-local/postgres`;
- database: fresh default `postgres` database inside the disposable container;
- local prelude: minimal `auth`/`storage` schemas, `auth.users`, `auth.uid()`, `storage.buckets`, and `anon`/`authenticated`/`service_role` roles required to parse the application migrations;
- raw logs: `/private/tmp/pi-bootstrap-results-20260715/`, directory mode `0700`, artifacts mode `0600`.

The local password was not logged or copied into repository reports.

## Applied sources

| Range | Source |
|---|---|
| `0001…0006` | readable remote snapshot whose Git blob IDs equal local HEAD |
| `0007` | exact local HEAD extraction preserved in `proposed-migrations/` |
| `0008` | exact local HEAD blob extraction in protected `/private/tmp` |
| `0009` | readable current worktree file |

Hashes are recorded in `migration-matrix.md`.

## Command pattern

The runner used the following local-only pattern for each migration:

```text
docker run --pull=never --rm -d --name <disposable-name> <postgres-16-image>
docker exec <disposable-name> pg_isready -U postgres -d postgres
docker exec -i <disposable-name> psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < <migration-file>
docker rm -f <disposable-name>
```

No connection URL, JWT, service-role key, or database password appears in the command record.

## Exit results

| Step | Exit/result |
|---|---|
| container start/readiness | `0`, ready |
| local Supabase-shape prelude | `0`, passed |
| `0001` | `0`, passed |
| `0002` | `0`, passed |
| `0003` | `0`, passed |
| `0004` | `0`, passed |
| `0005` | `0`, passed |
| `0006` | `0`, passed |
| proposed `0007` | `0`, passed |
| local-HEAD `0008` | `0`, passed |
| worktree `0009` | `0`, passed |
| schema assertions | `0`, passed |
| runner | `0`, passed |

## Assertions

- 13/13 expected public tables exist;
- RLS is enabled on all 13 tables;
- expected studio, room/task, concept-pack, and baseline policies exist;
- expected indexes exist, including rate limit, concept event, room idempotency, task-event idempotency, and one-room-event indexes;
- expected project/proposal/workflow constraints exist;
- expected functions exist:
  - `is_studio_member` — `SECURITY DEFINER`, `search_path=public`, default function ACL;
  - `record_concept_pack_created_event` — `SECURITY DEFINER`, `search_path=public`, default function ACL;
  - `create_project_room_from_accepted_proposal` — invoker, execute for `authenticated` after explicit public revoke;
  - `update_project_task_status` — `SECURITY DEFINER`, `search_path=public`, execute for `authenticated` and `service_role` after explicit public revoke.

## Re-run behavior

The following migrations were reapplied to the same local schema and passed:

- `0002`, `0003`, `0004`, `0005`, `0008`, `0009`.

The following whole files are explicitly **not** safe to re-run:

- `0001`: named policies are created without `DROP POLICY IF EXISTS`;
- `0006`: studio policies are recreated without dropping policies of the same names;
- `0007`: room/task policies are recreated without dropping policies of the same names.

They were not falsely marked idempotent merely because their tables use `IF NOT EXISTS`.

## Limitations

This proves SQL order, syntax, object dependencies, and the listed assertions. The minimal prelude does not reproduce Supabase-managed default grants, extensions beyond those requested by migrations, Auth behavior, Storage RLS, or production data. It does not replace the authoritative production ledger or a full local Supabase regression environment.
