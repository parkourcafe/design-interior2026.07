# ArchiDom RU — Production read-only fingerprint

Captured at: `2026-07-19T01:51:04Z`  
Supabase project: `design2026` (`ztnycrchwxqczqbyegnp`)  
Method: Supabase MCP, PostgreSQL catalog `SELECT` only

```text
PRODUCTION_OBSERVED=true
PRODUCTION_CHANGED=false
PRODUCTION_READY=false
PRODUCTION_APPLIED=false
```

## Scope and safety boundary

The observation queried PostgreSQL system catalogs, migration-row count and
Storage bucket controls. It did not read business-table rows, Auth identities,
object names, file contents, raw tokens or secrets. No migration, DDL, DML,
Auth configuration change, Storage mutation or deployment was performed.

The catalog result is treated as untrusted input and reduced to deterministic
counts/hashes before being recorded here.

## Runtime inventory

| Item | Observed value |
|---|---|
| PostgreSQL | `17.6` (project metadata: `17.6.1.141`) |
| Migration ledger rows | `0` |
| ProjectCEO schemas | none |
| Runtime roles | `anon`, `authenticated`, `authenticator`, `service_role` |
| ProjectCEO executor roles | absent |
| Storage bucket | `client-uploads`, private |
| Storage object policies | `0` |
| Bucket size limit | unset |
| Bucket MIME allowlist | unset |

Extensions:

- `pg_stat_statements` 1.11;
- `pgcrypto` 1.3;
- `plpgsql` 1.0;
- `supabase_vault` 0.3.1;
- `uuid-ossp` 1.1.

## Normalized catalog fingerprints

Each MD5 below is calculated by sorting normalized catalog lines within one
category. MD5 is used only as a deterministic drift checksum, not as a security
primitive. The combined SHA-256 covers the ordered category summaries.

| Category | Count | MD5 |
|---|---:|---|
| columns | 162 | `3a7b892956dcd30728a96a522da186f6` |
| constraints | 67 | `96f032653ef5ac618e12d72956d94058` |
| enums | 3 | `1f8c2ee7b1056b60566a0183338bf90a` |
| extensions | 5 | `75985b6f7213eef16b278a502d33831d` |
| grants | 339 | `49e0afc0f9936a0b944d4ceeb44a1664` |
| indexes | 51 | `440e878128d3a80b79edbda7418f27df` |
| policies | 16 | `424d04afaa779743fff686880fd7454e` |
| relations | 20 | `1f4cd04361a34e33911d1ca72561a585` |
| roles | 4 | `8db5e9a67b5d8eaef08374efb310b1ee` |
| routines | 18 | `9cf5d332b452760ea84c5928c7439a56` |
| triggers | 4 | `69efc83f7079948dab530c8454ece5f4` |

```text
combined_summary_sha256=
d9c756d2e9dc7b4dd054f8d8d1a84b86e928aabdab6a46d22e2b9e0bfcb0d77a
```

## Security observations

1. Every observed `public` relation has RLS enabled, but `public.rate_limits`
   has no policy.
2. `public.is_studio_member(owner uuid, uid uuid)` is a `SECURITY DEFINER`
   routine executable by `PUBLIC`, `anon` and `authenticated`.
3. Legacy `public` table grants remain broad. RLS is the effective row boundary;
   this is existing security debt and must not be copied into ProjectCEO schemas.
4. The private `client-uploads` bucket has no `storage.objects` policy and no
   explicit size/MIME controls. It is not ready for the authenticated pilot
   upload contract without a reviewed production change.
5. No `projectceo_api`, `projectceo_product_api`, `projectceo_m4_api` or private
   Project Intelligence schemas exist in production. Consequently PA-B18 cannot
   be satisfied in the current production runtime.

The current Supabase security advisor separately reports leaked-password
protection as disabled. That platform setting is not represented in PostgreSQL
catalog hashes and remains an Auth configuration gate.

## Comparison with 16 July observation

The high-level legacy shape remains consistent with the 16 July authoritative
observation: PostgreSQL 17.6, empty migration ledger and legacy public schema.
The newer snapshot also observes `rate_limits`, which the 16 July narrative had
classified as absent. Until the original 16 July attachment is compared against
this exact normalized contract, this is treated as known drift requiring DB and
Security review, not silently accepted.

No ProjectCEO/Project Intelligence production adoption has occurred.

## Gate impact

- PA-B01: fresh read-only observation obtained, but final closure still needs
  reviewer comparison/sign-off against the original authoritative attachment.
- PA-B02: remains open; ledger repair has not been authorized or performed.
- PA-B13: remains open; Storage authorization and object recovery are not ready.
- PA-B18: remains open; intended custom API schemas are absent.
- Production adoption verdict remains **NO-GO**.

