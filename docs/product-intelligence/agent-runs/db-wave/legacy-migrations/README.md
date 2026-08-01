# Legacy migration evidence

These files preserve the exact bytes of the pre-adoption `0001`–`0009`
migration candidates. The `.sql.txt` extension is intentional: none of these
files is executable migration input.

The active chain starts at:

```text
supabase/migrations/20260716071024_legacy_production_baseline.sql
```

Rules:

- do not rename evidence files back to `.sql`;
- do not execute them against production;
- do not mark their old numeric names as applied in the migration ledger;
- preserve `0009` only as rejected evidence;
- preserve the superseded local `0007_invite_tokens` candidate as evidence; it
  is not part of the audited production baseline;
- use `manifest.json` for source, production status and SHA-256 verification.
