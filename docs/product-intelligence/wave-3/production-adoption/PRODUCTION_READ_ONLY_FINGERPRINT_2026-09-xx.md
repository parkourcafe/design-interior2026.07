# RemHaOS — Production read-only fingerprint — 2026-09-xx

Status: `OWNER_INPUT_REQUIRED`

Production changed: `false`

## Generate locally

After the owner downloads the one-row JSON result, run:

```text
node scripts/ops/fingerprint-from-snapshot.mjs \
  --snapshot <path-to-downloaded-json> \
  --fingerprint-out <path-to-generated-fingerprint.md> \
  --baseline docs/product-intelligence/wave-3/production-adoption/PRODUCTION_READ_ONLY_FINGERPRINT_2026-07-19.md \
  --conflicts-out <path-to-generated-conflicts.csv>
```

Use a temporary output path first. Review the generated CSV before reconciling
its rows with the repository conflict register; do not overwrite existing
manually classified rows.

The generator:

- accepts raw JSON or the one-row Supabase SQL export shape;
- rejects any snapshot contract other than `remhaos-production-catalog/2.0`;
- sorts object keys and category rows before hashing;
- excludes capture time, database name and server version from category hashes;
- emits count plus MD5 for every normalized category;
- emits one SHA-256 over the ordered category summaries;
- emits drift rows only when a category changed, disappeared or has no July baseline.

## Generated fingerprint

Replace this section with the command output after reviewing it.

| Category | Count | MD5 |
|---|---:|---|
| `PENDING` | `PENDING` | `PENDING` |

```text
combined_summary_sha256=
PENDING
```

## Interpretation

Matching hashes prove only that normalized catalog metadata for that category
matches the compared snapshot. They do not prove Auth, SMTP, Storage contents,
backup/restore, browser behavior, deployment identity or production readiness.
