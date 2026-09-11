# WP-42 acceptance matrix

| ID | Requirement | Source | Code/evidence | Status | Gate |
|---|---|---|---|---|---|
| B1 | One public RemHaOS product | ADR-0005; owner variant B | ADR-0008 | VERIFIED | none |
| B2 | RU and international data cells | owner variant B | validated `DataCell` contract | PARTIAL | persistence + infrastructure |
| B3 | Assign market before data collection | owner variant B | pure resolver + auditable basis | PARTIAL | Auth/intake integration |
| B4 | Conservative RU default | attached plan; owner variant B | resolver tests | VERIFIED | none |
| B5 | No silent RU to international downgrade | attached plan; owner variant B | resolver tests | VERIFIED | none |
| B6 | Cell-specific DB/Auth/Storage | owner variant B; ADR-0008 | policy only | NOT_STARTED | cloud + migration/security |
| B7 | Cell-specific AI allowlist | attached plan | RU allowlist; international disabled | PARTIAL | provider approval + runtime verification |
| B8 | Separate legal operator/currency/locale | attached plan | explicitly decoupled from cell | NOT_STARTED | legal/business approval + UI |
| B9 | Existing data migration | architecture invariant | none | UNKNOWN | owner migration decision |
| B10 | Production activation | repository rules | no deployment evidence | NOT_STARTED | owner production gate |
