# ProjectCEO RU — request-bound UI integration report

Дата: 18 июля 2026 года.

## Итог

Request-bound слой собран и security-reviewed, но статус реального authenticated pilot — **conditional / NO-GO до закрытия read-contract gaps и production-adoption gate**. Локальный Kora browser demo готов как изолированный read-only evidence, а не как доказательство production RLS.

## Сделано

- Dashboard ProjectCEO переведён с deployable mock-role hydration на request-bound server port.
- Добавлены controlled read endpoints для portfolio и project workspace.
- Добавлен единый mutation endpoint со strict schema, same-origin проверкой и стабильной идемпотентностью.
- Human JWT остаётся в request-bound Supabase client; service role и worker executor отсутствуют.
- Live DTO sanitization скрывает production filenames, absolute paths и private relation details.
- Exact M4 handover counts считаются по дедуплицированным area IDs.
- Distribution UUID не выдаётся без recipient-bound read field.
- Ошибочные downstream envelopes, multi-org portfolio и неоднозначные sibling package grants завершаются fail-closed.
- Добавлен безопасный development-only Kora QA route для пяти ролей.

## Проверка

Зелёные scoped gates:

```text
./node_modules/.bin/tsc --project /private/tmp/projectceo-tsconfig.json --noEmit
PASS

./node_modules/.bin/vitest run tests/projectceo-integration
5 files, 27 tests passed

./node_modules/.bin/vitest run tests/projectceo-integration tests/projectceo-ui
10 files, 54 tests passed

git diff --check
PASS
```

Покрыты: null Auth data, claims/user mismatch, CSRF, strict schemas, authority-field rejection, retry idempotency, exact version target, sibling scope rejection, multi-org rejection, required-envelope errors, route-handler early rejects и redaction, evidence quarantine, M4 area deduplication, local production guard и отсутствие human worker/service-role paths.

## Остаток до authenticated pilot

1. Additive read RPC для decisions/selections и package-scoped sources.
2. Recipient-bound distribution projection для acknowledgement.
3. Полный invitation acceptance/delivery flow и guest grant read model.
4. UI-контролы для review impact, photo review и milestone acceptance.
5. Реальные area/location/pilot analytics вместо controlled `0`/нейтральных placeholders.
6. Organization selector и per-package role/scope DTO либо явное ограничение pilot tenant model.
7. Controlled production schema exposure, test users, RLS browser run и только затем production adoption.

До этих пунктов отчёт нельзя трактовать как разрешение деплоя или подтверждение полного Kora end-to-end на живой Supabase.
