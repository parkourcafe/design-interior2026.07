# WP-26  BUG-05 (1):$EBD4=<FK$48749=5@0!’ request-bound + RLS  EVIDENCE

4B0: 2026-09-10. 5B>0: `wp/wp-26-designer-pages-request-bound`. 470: `90f72b6ac5381b2b3a4f1108bbdeac93411f0aa7` (current `main`). HEAD: `1619e1c`. PR: #141 (draft, unmerged).

##$A=>24=85

_'] 4@F>G>0 WP-26 FD55G5B request-bound$>;<5=B$4?O 4GB5=B<D8F<@>60==KE$AFD0=<F,$AG65=<5 service-role allowlist 4> >?0EE0 ,0), ?>;=O9 CI$8 =57468E<<O9 security review.

_'] R26$D07D5L45B$B5>CM<5 token-scoped$<4DHDGBK$4>$7465DL5=<O$8 ?D8=OB<O WP-26; production 8$=>6K5$<4DHDGBK$=5$@47@5L5=K.$&5>GI<9 74?GE:$>B45;L=>$D07D5L45B$=5>1E>4<<K5 additive migration/RLS/security$<7<5=5=8O, commit, push$8 PR.

[']$DE8F5:FG@0$8 capability matrix$F@55CNB 4>B<6=>7>$G;5=AF60$8 server-side scope checks;$0=>=<<=O5 legacy event writes$=5$?>?CG4NB$H<D>>>9 INSERT-?>?8F<:8.

## Allowlist$?>$D4>BC

_'] 7<5=Q==K5$D4=;K$2E>4OB 2 allowlist WP-26 <?8$>1O70F5;L=K9 migration/test ledger protocol:

```text
app/api/pilot/route.ts
app/dashboard/projects/[id]/page.tsx
app/join/[token]/actions.ts
app/join/[token]/page.tsx
lib/designer.ts
lib/intake.ts
lib/supabase/token-scoped.ts
supabase/migrations/20260910100000_projectceo_wp26_storage_rls.sql
tests/ap1/environment/migration-ledger.sha256
tests/db4/56_m1_rls_security.sql
tests/layout-studio/integration/integration.test.ts
tests/release/service-role-allowlist.test.ts
docs/audits/wp/WP-26_EVIDENCE.md
```

[']$!GM5EF2GNI<5 <<3D4F<8 =5 ?5@5?8E4=K; =>24O <<3D4F<O additive.

##$7<5=5=<O

_'] Dashboard page$?>4?8EO245B client-uploads$G5D57 request-bound Storage client A TTL 900$E5>G=4.

_']$>542?5=0 `20260910100000_projectceo_wp26_storage_rls.sql` (S-MIG #5): private `client-uploads`$?>?GG45B$F>?L:> authenticated SELECT policy,$>3D4=<G5==CN project UUID path$8?8 path$2 project answer metadata,$?D<=44;560M<<$EBG488$?>?L7>24F5?O.$ disposable DB4 storage.objects$>BEGBEF2G5B,$?>MB><C migration replayable$G5D57 guarded DO;$=0 Supabase policy$A>744UBEO.

['] `lib/intake.ts`, `lib/designer.ts`, invite preview$8 invite acceptance$<A?>;L7CNB F>;L>> purpose-scoped helper; invite acceptance 4>?>?=<F5?L=>$A65@O5B$=>D<0?<7>60==K9 authenticated email,$0F><4D=>$34E8B$B>?L>> 5MQ invited token 8$A>>1M45B invalid$?@8$3>=:5/?>6B>D5.

_'] Pilot route ?5@5654U=$=0 request-bound client$8 fail-closed (503),$>>740 legacy events RLS$=5$D07D5L45B anonymous pilot insert. Anonymous INSERT policy$=5$4>506?O?4AL.

_'] Service-role static boundary 5>;LL5$=5$E>45@6<B WP-26 residual raw callers.

## %>BE?>FK 8$?<=K

['] H3H7, H11$8 H14$=5$70FD>=GBK. Public token paths$>AF4NFEO$F>?L:>$2 class ,0) WP-25 helper A$B>G=O< purpose; authenticated dashboard/studio paths$5>?LH5$=5$8E?>?L7GNB$?@O<>9 admin client.

['] TTL signed URL$>EF0UFAO 900 E5:G=4; private bucket$8 replay/one-time invite invariants$=5$>E?05?5=K.

##$<7@4F8O

|$D4=; | DB4/DB5-AF5=4D89 | S-MIG |
|---|---|---|
| `20260910100000_projectceo_wp26_storage_rls.sql` | `56_m1_rls_security.sql`$8 full DB4/DB5 harness | #5 |

_'] Timestamp$6K5D0=$?>E;5 `20260910090000`;$AGM5EF2GNI4O >G5D54L$8$?@<>@<F5FK =5 <5=O?8EL. Migration ledger regenerated.

##$>>0?L=O5 759FK

_'] `git diff --check`: exit 0; static allowlist: 20 tests passed; migration integration: 7 tests passed; `npm run typecheck`: exit 0.

_'] DB4 PG16$8 PG17: `DB4_PRODUCT_BRAIN_HARNESS_OK`.

_'] DB5 PG16 8 PG17: `DB5_EXECUTION_HARNESS_OK`.

_']$>?=K9 `npm run release:check`$8$>1O70F5;L=K9 CI$4>?6=K 5OBL$?>6B>D5=K =0 D<=4?L=>< SHA$?>E;5 commit/push.

## CI$8 blind review

[']$D54O4CM<9 run `34430498992`$?@>E>4<; lint/typecheck/test/build, AP5, DB4$8 DB5$=0$5>?55$D0==5< SHA;$D8=4;L=K9 push$F@55C5B =>2>7> run.

_'] Claude run `34430498980`$7465DL8?EO permission denial$557 findings; ??0F=K9 rerun$=5$2O?>?=O?EO.

_'] Codex Security scan `22d79369-e596-43aa-a15b-39cc1ae41428`$7465DLQ=: reportable findings 0. Hosted adoption >EB4UBEO >F45?L=O< gate.

##$5$A45;4=> / 6O=5E5=>

_&$ &$] Merge PR #141, shared staging/production migration$8 deploy$=5$2O?>?=O?<AL. Pilot anonymous event remains unavailable until separately approved contract/policy;$MB> fail-closed$?>6545=<5.

##$57>?4A=>AFL

_'] Production, shared DB, credentials 8 CI settings$=5$8E?>?L7>60?<AL. %5:D5BK$2 diff 8 evidence$=5$4>506?O?<AL. Existing migrations preserved.
