# WP-33 work-package request-bound release — evidence

[ИЗВЛЕЧЕНО] Реализована additive migration `20260911140000_projectceo_publish_work_package_release_request_bound.sql` (S-MIG #5): SECURITY DEFINER RPC `publish_work_package_release_request_bound(uuid,uuid,text,text,bigint,text,text)` доступна только `authenticated` и авторизует выбранный package через существующий `_authorize_package_human(..., 'publish_release')` до package lookup.

[ИЗВЛЕЧЕНО] Композиция строгая: source revisions берутся только из `source_materializations` того же package и текущего baseline; requirement/assumption — из package-tagged payload; decision/selection — из package-bound descriptors. Fallback на все baseline sources отсутствует.

[ИЗВЛЕЧЕНО] DB4 PG16/PG17 и DB5 PG16/PG17 прошли локально. `npm run release:check` прошёл на SHA `dee283f`.

[ИЗВЛЕЧЕНО] Local AP5: `BLOCKED_EXTERNAL` — установленный Playwright CLI отвечает `unknown command 'test'`; tooling не менялся. Hosted PR AP5 остаётся обязательным.

[ИЗВЛЕЧЕНО] Independent Codex Security diff scan `8b5270fc-b244-4f7a-b62c-32bf217d23de` на final implementation SHA: 0 findings.

[ИЗВЛЕЧЕНО] Scope extensions: DB4-62 provenance assertion; migration/RPC inventory and ledger pins; deterministic work-package release IDs in DB4 backlog/concurrency fixtures; dependent state revisions; source-review assertion теперь проверяет logical uniqueness revision при нескольких physical inventory records. Positive second release не подменяется: остаётся за существующим `HUMAN_REVIEWED_IMPACT_REQUIRED` gate.
