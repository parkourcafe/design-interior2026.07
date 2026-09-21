# R1-13 adoption decision gates

Status: `NO_GO` until every item has exact evidence.

| Gate | Required evidence | Current state |
| --- | --- | --- |
| Database adoption | Restored clone baseline repair, exact 98-entry rehearsal, postcheck | BLOCKED_EXTERNAL: clone SQL browser-control unavailable |
| Storage recovery | Private object manifest, byte hashes and post-recovery access negatives | MISSING |
| Auth | Five role sessions and real email/auth delivery evidence | MISSING |
| R1 assets | Identities, upload, AV, delivery, representation and technical-reference contracts integrated on one SHA | IN_PROGRESS |
| DWG fidelity | Server parser output visually compared by architect to control PDF on real corpus | BLOCKED_EXTERNAL: parser runtime absent |
| External package | Second real package through the same contracts | MISSING |
| Release candidate | Exact merged SHA, green local/DB/browser evidence and independent security review | MISSING |
| Production action | Explicit owner gate immediately before shared DB/deploy | NOT REQUESTED |

No row authorizes production mutation, deploy, flag enablement or merge.
