# WP-42 decision log

## 2026-09-11 — one product with regional cells

- Decision: implement variant B with public brand RemHaOS, `ru` and
  `international` regional cells.
- Authority: owner, message “начать реализацию варианта B.”
- Evidence: ADR-0005 already resolves the public brand; attached market plan
  defines variant B.
- Supersedes: ADR-0004's current prohibition on a second runtime cell.
- Preserves: one codebase, four workspaces, internal compatibility namespaces.

## 2026-09-11 — conservative routing default

- Decision: unknown/invalid market routes to `ru`; Russian trusted signals can
  force `ru`, never force international.
- Authority: approved variant B specification and safe default.
- Rejected: IP-only citizenship inference; client-selected provider/cell;
  defaulting unknown users to international.
