# WP-34 — M4 backlog №5 и №4 — EVIDENCE

Дата: 2026-09-10. Ветка: `wp/wp-34-m4-backlog-5-and-4`. Базовый HEAD: `abc7ccbd8b903980a30ade95b5911531d20bbcdb` (свежий `origin/main`). Кандидат проверяется на `HEAD` перед push.

## Основание

[ИЗВЛЕЧЕНО] Карточка `docs/execution/wp/WP-34-m4-backlog-5-and-4.md`, трек 3.3/W2, S-LRP, без миграции. SQL-половина M4 backlog №5 уже поставила в v11 поле `data.approvalSupersededEntities`; этот пакет добавляет его потребление в поверхности baseline. M4 backlog №4 возвращает проверку предпосылок `accept_milestone` только под disposable-флагом `REMHAOS_M4_V2_V3_ENABLED`.

## Allowlist по факту

Вывод `git diff --name-only abc7ccbd8b903980a30ade95b5911531d20bbcdb...HEAD` содержит только:

- `lib/project-intelligence/delivery/projectceo/live-read-port.ts`
- `tests/projectceo-integration/live-read-sanitization.test.ts`
- `docs/audits/wp/WP-34_EVIDENCE.md`

Все три файла входят в allowlist карточки. Migration/RLS/security/CI settings не менялись.

## Хотспоты

H14/S-LRP: `live-read-port.ts` потребляет v11 read field и не меняет adapter contract. Тестовый файл проверяет baseline supersession и три состояния milestone acceptance. Остальные хотспоты не тронуты.

## Пины

| пин (файл:строка) | было | стало | основание |
|---|---|---|---|
| `lib/project-intelligence/delivery/projectceo/live-read-port.ts` | baseline token предлагался при любом успешно собранном составе | непустой `approvalSupersededEntities` даёт `prerequisite_missing` | v11 `20260828020000`, A6 §4.2.5 |
| `tests/projectceo-integration/live-read-sanitization.test.ts` | V2/V3 acceptance всегда ожидался закрытым | под `REMHAOS_M4_V2_V3_ENABLED=true` проверяются `prerequisite_missing` для undecided/rejected и точная веха для accepted | DEC-039 disposable GO |

## Миграция

Нет. Нового migration slot не требуется; v11 migration уже присутствует в базовом `main`.

## Локальные гейты

- `npm ci` — exit 0 с task-local npm cache `/private/tmp/npm-cache-wp34`.
- Focused: `npm test -- --run tests/projectceo-integration/live-read-sanitization.test.ts` — 1 file, 26 passed.
- `npm run release:check` — exit 0: lint 0 errors/13 pre-existing warnings, typecheck pass, 199 files/1599 passed/10 skipped, build pass (45 routes).
- `git diff --check` — pass.
- Regression proof: the updated focused test copied onto a detached baseline
  `abc7ccbd8b903980a30ade95b5911531d20bbcdb` failed 1/26 because the
  superseded-approval fixture still returned `publish_baseline: available`;
  the same test on this candidate passes 26/26.

## CI

UNKNOWN до push. Записать run IDs и AP5 artifact после push на точном HEAD.

## Grep-проверки

- `rg -n "approvalSupersededEntities|publish_baseline" lib/project-intelligence/delivery/projectceo/live-read-port.ts tests/projectceo-integration/live-read-sanitization.test.ts` — поле ранее присутствовало только в фикстуре; теперь surface проверяет непустой список перед выдачей baseline token.
- `rg -n "REMHAOS_M4_V2_V3_ENABLED|accept_milestone" tests/projectceo-integration/live-read-sanitization.test.ts` — три параметризованных состояния идут под явным флагом; выключатель M4 остаётся отдельным тестом.
- `git diff --name-only` — перед commit подтвердить только три allowlisted файла.

## Не сделано / вынесено

Production, release, shared DB, credentials, migration, RLS, security и CI settings не затрагивались. V2/V3 открываются только в disposable тестовом контуре при флаге; production adoption не следует из этого пакета.

## Blind review

UNKNOWN в момент локального кандидата; отдельный read-only review должен быть записан после проверки точного diff перед owner merge.

## Безопасность

[ИЗВЛЕЧЕНО] Production не использовался. Секреты не читались и в логи/evidence не выводились. Ветка создана от свежего `origin/main`.
