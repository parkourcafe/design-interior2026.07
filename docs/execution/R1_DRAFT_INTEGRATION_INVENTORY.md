# R1 draft integration inventory

Draft branches are not integration inputs until their exact SHA has passed the
required package gate.

| PR | Package | Status | Integration prerequisite |
| --- | --- | --- | --- |
| #160 | R1-03 worker policy | Local contract + later WP-32 real-corpus/bound-intake evidence | Production Gate0 remains open; local evidence is not hosted/adoption approval. |
| #161 | R1-04 delivery helper | FINDINGS | Server broker, grant RPC and range-read storage port missing. |
| #162 | R1-01 identities | FINDINGS_PENDING | Disposable DB apply and final review needed. |
| #163 | R1-08A technical reference helper | Local contract only | Depends on R1 identity persistence. |
| #164 | R1-11 lifecycle helper | Local contract only | Retention policy/legal gates missing. |
| #165 | R1-12 gate matrix | Evidence documentation | Reflects current unintegrated state. |
| #166 | R1-13 decision gates | Evidence documentation | No production authority. |

No branch in this table authorizes production, deployment, shared database
mutation or merge.
