# Wave 3 Agent 4 — Thin M4 Execution Persistence

Дата: 17 июля 2026 года.
Статус: локальный additive candidate; production не изменялся.

```text
THIN_M4_PERSISTENCE=true
M4_HUMAN_ADAPTER=true
M4_WORKER_ADAPTER=true
DB5_PG16=true
DB5_PG17=true
CONCURRENCY=true
ROLLBACK=true
RESTART_REPLAY=true
RELEASE_GATE=true
PRODUCTION_CHANGED=false
INDEPENDENT_M4_REVIEW=ACCEPT
```

Независимый DB/security review 18 июля 2026 года повторно применил всю additive
цепочку на чистых PostgreSQL 16 и 17 и принял M4 после blocker-fixes. Verdict
относится к локальному thin-M4 candidate; это не разрешение на production apply.

## Результат

Материализован узкий DB-backed M4-контур ProjectCEO RU:

- exact ChangeRequest между двумя immutable baseline;
- deterministic bounded impact traversal и human disposition;
- DB-enforced запрет публикации изменённого ProductionPackageVersion до полного
  human impact review;
- milestones, exact area revisions и photo evidence;
- human review фото и closure-controlled milestone acceptance;
- exact handover documents;
- immutable construction handover с устойчивым semantic hash;
- package-scoped execution projection без Storage path и original filename;
- раздельные authenticated-human и service-role worker RPC;
- typed PostgreSQL adapters без caller-supplied actor, Organization или role.

Существующие timestamped migrations не переписывались. Production Supabase и
production Storage не изменялись.

## Изменённые файлы

```text
supabase/migrations/20260717102000_projectceo_m4_execution_persistence.sql
supabase/migrations/20260717103000_projectceo_m4_execution_operations.sql
lib/project-intelligence/adapters/postgres/execution.ts
lib/project-intelligence/adapters/postgres/index.ts
lib/project-intelligence/adapters/postgres/rpc.ts
tests/db5/10_schema_security.sql
tests/db5/20_execution_operations.sql
tests/db5/30_restart_replay.sql
tests/db5/adapter-contract.test.ts
tests/db5/static-boundary.test.ts
tests/db5/run-concurrency.zsh
tests/db5/run.zsh
docs/product-intelligence/wave-3/agent-4/EXECUTION_M4_REPORT.md
```

Для восстановления локального release-gate также выровнен development toolchain:

```text
.gitignore
eslint.config.mjs
next.config.mjs
package.json
package-lock.json
tsconfig.json
vitest.config.ts
```

`NEXT_DIST_DIR` является необязательным. Production сохраняет стандартный `.next`,
а локальная сборка в iCloud workspace использует `.next.nosync` и не создаёт
конфликтные копии файлов с суффиксами ` 2` / ` 3`.

## Persistence surface

Private owner-only schema `projectceo_m4` содержит 16 forced-RLS relations:

1. `change_requests`;
2. `change_request_roots`;
3. `impact_runs`;
4. `impacts`;
5. `impact_path_steps`;
6. `impact_reviews`;
7. `milestones`;
8. `milestone_areas`;
9. `photo_evidence`;
10. `photo_evidence_reviews`;
11. `milestone_acceptances`;
12. `handover_documents`;
13. `construction_handovers`;
14. `handover_milestone_refs`;
15. `handover_photo_refs`;
16. `handover_document_refs`.

Все relations принадлежат `pi_table_owner`, имеют `ENABLE/FORCE RLS`, owner-only
policy и не имеют direct table grants для `anon`, `authenticated`, `service_role`,
`pi_human_executor` или `pi_worker_executor`. Append-only guards запрещают
UPDATE/DELETE immutable execution records.

Composite foreign keys структурно связывают:

- ChangeRequest с exact from/proposed baseline lineage;
- impact с exact target graph version и root revision;
- milestone area с exact graph node revision;
- photo/handover source с exact materialized source revision и checksum;
- handover photo reference с exact package и ProductionPackageVersion исходного
  accepted photo review;
- acceptance и construction handover с exact package version, semantic digest и
  closure references.

## RPC surface

В `projectceo_m4_api` опубликованы ровно 10 fixed-definer RPC.

### Authenticated human

- `submit_change_request`;
- `review_change_impact`;
- `define_milestone`;
- `register_photo_evidence`;
- `review_photo_evidence`;
- `accept_milestone`;
- `register_handover_document`;
- `get_execution_delivery`.

### Service-role worker

- `calculate_change_impact`;
- `build_construction_handover`.

Human RPC недоступны service role. Worker RPC недоступны authenticated role.
Private helper functions недоступны обоим runtime roles.

## Security boundary

- application adapter вызывает только `projectceo_m4_api`;
- private tables не читаются через `.from(...)`;
- actor/user/Organization/package membership/capability/effective role и server
  time выводятся PostgreSQL;
- human operation не может передать actor identity или выполнить worker command;
- worker не может выполнить human review;
- cross-tenant и cross-package чтение/изменение отклоняются;
- closed package version после handover не принимает новые milestones, photo
  reviews или documents;
- accepted milestone закрывает свой photo stream: позднее photo evidence или
  review не могут изменить immutable acceptance snapshot;
- read projection не возвращает Storage object path или original filename.

## Change и impact contract

- ChangeRequest относится к exact previous/proposed baseline pair;
- proposed baseline обязан непосредственно продолжать from baseline;
- thin P0 поддерживает replacement существующих Decision/Selection revisions;
- отсутствие change roots отклоняется;
- impact depth находится в диапазоне `1..20`;
- traversal cycle-safe, хранит shortest deterministic path и ограничен 5000
  impacts;
- impact identity выводится из exact ChangeRequest/target version/path и не
  зависит от случайного `impact_run_id`;
- каждый impact требует human disposition
  `accepted | resolved | dismissed`;
- fail-closed release-gate требует, чтобы каждый exact ChangeRequest root был
  материализован хотя бы одним impact в выбранном run; пустой или неполный run
  не может пройти проверку только из-за отсутствия непросмотренных строк;
- изменённый production package не публикуется до наличия impact run и human
  disposition для каждого impact;
- один package baseline transition допускает ровно один ChangeRequest;
- duplicate same idempotency key/digest возвращает replay;
- same key/different digest возвращает controlled idempotency conflict;
- concurrent same command даёт одну physical запись, один state increment,
  один `replay=false` и один `replay=true`.

## Milestone, photo и handover closure

Milestone фиксирует exact:

- ProductionPackageVersion;
- ProjectBaseline;
- graph version;
- area node и area revision.

Photo evidence принимается только из materialized Source inventory с exact
SourceRevision/checksum и допустимой source role. Human review обязателен.

Deferred structural closure запрещает milestone acceptance, если хотя бы одна
area не имеет accepted photo. Construction handover запрещён, если:

- не приняты все milestones exact package version;
- отсутствует warranty document;
- отсутствует хотя бы один exact accepted-photo ref;
- closure refs не совпадают с exact acceptance/photo/document rows, package или
  ProductionPackageVersion.

После handover package version закрывается для последующих M4 mutations.

## Hash contract

Construction handover хранит:

```text
contractVersion = project-ceo-construction-handover/0.1
algorithm = sha256
encoding = utf-8
hashedField = semanticContent
canonicalization = jsonb_recursive_sorted_object_keys_arrays_contract_order
```

Из semantic hash исключены volatile fields:

```text
artifactId
generatedAt
jobStatus
signedUrl
```

Restart replay возвращает тот же handover ID и semantic hash без нового state
increment.

## Application adapters

`execution.ts` разделяет:

- `ProjectCeoM4HumanPostgresAdapter`;
- `ProjectCeoM4WorkerPostgresAdapter`.

Human adapter предоставляет change review, milestone, photo, document и
package-scoped read operations. Worker adapter предоставляет только bounded impact
calculation и deterministic handover construction.

Delivery envelope валидируется на runtime contract
`project-ceo-m4-delivery/0.1`, exact UUID scope, safe state revision и ожидаемые
projection arrays.

## DB5 acceptance

DB5 применяет Supabase prelude и всю additive migration chain в чистом isolated
PostgreSQL container, затем выполняет Foundation, M2/M3 и M4 vertical flow.

Покрыто:

- schema/ACL/owner/search-path/forced-RLS checks;
- supporting indexes для foreign keys;
- exact human/worker grants;
- exact baseline and package-version lineage;
- premature changed-package release denial до полного human impact review;
- fail-closed root-to-impact coverage для каждого ChangeRequest root;
- deterministic bounded impact и human disposition;
- materialized photo source и exact source revision;
- milestone closure negative/positive;
- warranty closure negative/positive;
- handover-without-photo-ref negative closure;
- accepted-milestone late-photo denial;
- exact construction handover semantic hash;
- package-scoped projection и отсутствие filenames/paths;
- cross-tenant denial;
- stale-state и idempotency conflict;
- injected rollback;
- append-only immutability;
- closed-version denial;
- concurrent same-key milestone definition;
- database restart и replay proof.

## Verification

```text
DB5 PostgreSQL 16                                 PASS
DB5 PostgreSQL 17                                 PASS
DB5 concurrency                                   PASS
DB5 rollback                                      PASS
DB5 restart replay                                PASS
DB5 adapter/static contracts                      PASS — 8/8

npm run typecheck                                 PASS
npm run test                                      PASS — 50 files / 295 tests
npm run lint (isolated nonsync release copy)      PASS — 0 errors / 9 legacy warnings
NEXT_DIST_DIR=.next.nosync next build --webpack   PASS — 18/18 static pages
npm audit --omit=dev                              PASS — 0 vulnerabilities
npm audit                                         PASS — 0 vulnerabilities
git diff --check                                  PASS
zsh -n tests/db5/*.zsh                            PASS
```

## Residual gaps перед production

- Thin M4 теперь блокирует production-package release до reviewed impact, но
  `ProjectBaseline` всё ещё создаётся отдельной M3-командой до ChangeRequest.
  Charter-инвариант одной atomic команды
  `approved change → baseline + production package + outbox` остаётся отдельным
  cross-module production-adoption решением.
- Worker RPC доступны только `service_role`, а human RPC ему недоступны. Перед
  production желательно заменить широкую worker credential на dedicated
  executor/job binding с минимальными правами.
- Depth `1..20`, cycle guard и result cap `5000` ограничивают результат, но
  dense graph может породить много candidate paths до финального cap. Нужен
  production load test на верхней границе реального Project Graph.
- Browser/auth/device QA и фактическое подключение request-bound UI находятся
  вне DB5 acceptance и должны пройти отдельный integration gate.

Первый clean Webpack build в iCloud workspace занял 10,6 минуты, затем warm build
завершился за 2,2 секунды. Static generation первой clean попытки повторила семь
legacy pages после 60-second threshold и успешно завершила 18/18.

ESLint приведён к официальному Next 16 flat-config stack:

- `eslint 9.39.5`;
- `eslint-config-next 16.2.10`;
- `vitest 4.1.10`.

Новое React Hooks 7 правило `set-state-in-effect` отключено только для сохранения
pre-Next-16 legacy lint contract. Рефакторинг шести несвязанных legacy effects не
входит в M4 slice. Девять существующих unused warnings остаются видимыми.

## Known limitations

- production Supabase не изменялся;
- live Kora import этим срезом не выполнялся;
- UI пока не вызывает M4 adapter через request-bound server actions/routes;
- browser QA owner/architect/builder/client ещё не выполнен на DB-backed M4;
- WhatsApp integration, ERP, склад, бухгалтерия и CAD/3D не добавлялись;
- production adoption остаётся отдельным контролируемым решением;
- first clean local build в iCloud workspace дорогой; для локальных gates нужно
  использовать `.next.nosync`.

## Следующий gate

1. Подключить human adapter только через request-bound server composition.
2. Подключить worker adapter только через trusted job boundary.
3. Заменить M4 mock DTO на `get_execution_delivery` постепенно.
4. Выполнить browser QA для owner/architect/builder/client.
5. Прогнать Kora change → impact → photo → acceptance → handover end-to-end.
6. Только затем подготовить отдельное production-adoption решение.
