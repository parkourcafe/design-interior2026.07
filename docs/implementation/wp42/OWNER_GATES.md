# WP-42 owner gates

| Gate | State | Exact action | Prerequisites / rollback |
|---|---|---|---|
| G42-DB | OPEN | Add market/cell persistence migration and RLS/RPC | reviewed schema, free S-MIG/DB4 slot; additive rollback plan |
| G42-RU-CLOUD | OPEN | Create/pay/configure Russian DB/Auth/Storage cell | provider choice, budget, DPA/region/backup evidence |
| G42-LEGAL | OPEN | Approve RU/US legal operators, policies and filings | verified entities, address/contacts, counsel review |
| G42-MIGRATE | NOT_REACHED | Move existing users/projects | inventory, classification, rehearsal, per-project rollback |
| G42-PROD | NOT_REACHED | Enable routing/env/DNS in production | green CI, hosted dual-cell E2E, exact SHA, rollback switch |
| G42-GOV | OPEN | Amend `AGENTS.md` and mark historical RU-only plans superseded | explicit owner approval for governance files; additive marker block only |
