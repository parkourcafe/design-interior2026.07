# Release Control

## Source of truth

- Code lives in this git repository: `repo/`.
- Production is deployed from a reviewed git state, not from an unknown dirty workspace.
- Secrets stay in Vercel/Supabase env settings. Local `.env.local` is ignored.
- Database changes are shipped as ordered SQL files in `supabase/migrations/`.

## Release checklist

1. Check the workspace:
   `git status --short`
2. Review the diff:
   `git diff`
3. Run the release gate:
   `npm run release:check`
4. Apply any new Supabase migration in the Supabase SQL editor or via the Supabase CLI.
5. Commit the exact source state.
6. Deploy:
   `npm run deploy:prod`
7. Verify production:
   `/api/health`, login, accepted proposal -> Project Room creation.

## Current Module 3 workflow guarantees

- `create_project_room_from_accepted_proposal` is the only write path for creating a room from an accepted proposal.
- The function runs in one Postgres transaction.
- The action is idempotent by project and `idempotency_key`.
- Rooms and tasks carry versions and workflow state.
- Activity events are written during the same transaction as room/task creation.
