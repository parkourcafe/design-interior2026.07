# Security report — 2026-08-02

Status: **PARTIAL / clone evidence only**.

DB4/DB5 security harnesses pass on PostgreSQL 16 and 17: private tables use
forced RLS, direct table grants are denied, definer functions have pinned
`search_path`, human operations are not exposed to worker/service roles, and
request-bound outsider access is rejected. M2 financial fields are masked from
the client-approver projection. Production ACL/RLS verification remains a
separate gate because production uses a different schema surface.
