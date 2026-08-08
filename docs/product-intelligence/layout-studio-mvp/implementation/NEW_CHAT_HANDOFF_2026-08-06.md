# ArchiDom Layout Studio M2 — handoff в новый чат

Дата фиксации: 6 августа 2026 года.

## 1. Неподвижный контекст

- Репозиторий: `parkourcafe/design-interior2026.07`.
- Рабочая ветка: `codex/archidom-layout-studio-m2`.
- Базовая ветка GitHub на момент handoff: `claude/new-session-gsayp3`.
- Модуль: native ArchiDom Layout Studio, изолированный M2.
- Feature flag: `ARCHIDOM_LAYOUT_STUDIO_ENABLED=false` — default-off.
- Production merge запрещён до 100% P0 acceptance PASS, повторного независимого аудита и отдельного merge decision владельца Selena.
- Изменения БД могут быть только additive. Timestamped migrations не переписывать.
- Runtime не получает прямой доступ к private Project Intelligence tables; human operations не выполнять через service role.
- Actor, organization, project, package и role выводить server-side.
- Не публиковать секреты, `.env.local`, production filenames, абсолютные локальные пути или KORA manifest в public assets.

Основные продуктовые источники истины:

- `docs/product-intelligence/ArchiDom_Russia_Product_Charter_v0.4_2026-07-18.md`
- `docs/product-intelligence/wave-3/MASTER_EXECUTION_PLAN.md`
- `docs/product-intelligence/architecture-v1.md`
- `docs/product-intelligence/adr/0004-one-archidom-four-workspaces.md`
- `docs/product-intelligence/adr/0006-native-layout-studio-m2-research-gate.md`
- `docs/product-intelligence/layout-studio-mvp/implementation/CONTINUATION_TRANSFER_AUDIT_2026-08-06.md`
- `docs/product-intelligence/layout-studio-mvp/implementation/ACCEPTANCE_LEDGER_2026-08-06.csv`

## 2. Что уже сделано

Последовательность коммитов продукта:

- `69419ad` — reference package.
- `f4ad553` — автономный Layout Studio M2 preview.
- `1978b27` — закрытие десятидневного плана.
- `0c20a54` — continuation rebuild.
- `b2e1dd6` — interaction fallbacks.
- `91fe597` — schema/export/auth/dependency/security hardening.
- `679b3c5` — закрытие оставшихся code-level acceptance gaps.
- `545f9af` — финальная фиксация acceptance evidence перед handoff.

Реализовано и проверено автоматикой:

- canonical document model и frozen JSON Schema с AJV validation;
- согласованные runtime schema и TypeScript contracts;
- idempotency/conflict ledger, monotonic undo/redo revisions;
- checkpoints, hydration и version envelope `archidom.layout-version/0.1`;
- publish validation: schema, parent existence и принадлежность одному документу;
- восстановление после повреждённого local storage;
- root-level document diff;
- 2D/3D projection из одного canonical document;
- стены разбиваются вокруг проёмов, проёмы не становятся отдельными объёмами;
- один canonical ceiling, WebGL selection highlight и parent mapping;
- exact-version export через `LayoutExportService`: JSON, SVG, GLB, print artifact;
- PNG заданного размера и полный manifest;
- semantic hash recomputation и export privacy gate;
- auth proxy matcher для `/app/layout-studio`;
- KORA fixture и owner-confirmed geometry intent.

Зафиксированная владельцем геометрия KORA:

- помещение 8100 × 3000 мм;
- колонна 250 × 250 мм;
- дверь 1200 мм на одной оси с колонной;
- левая сторона: 1500 мм открыто / 1500 мм стена;
- правая стена сплошная;
- стойка 1100 мм;
- рабочая поверхность 900 мм.

Fixture: `fixtures/layout-studio/kora-liquid-station.v0.1.json`.

## 3. Последние проверки

На коде `679b3c5` и evidence commit `545f9af` получено:

- `npm run lint` — PASS, 0 errors; 10 ранее существовавших warnings;
- `npm run typecheck` — PASS;
- `npm run test` — PASS, 70 файлов / 408 тестов;
- Layout Studio suite — PASS, 14 файлов / 80 тестов;
- `npm run build` — PASS, Next.js 16.3.0;
- `npm audit` — 0 vulnerabilities;
- `git diff --check` — PASS.

Browser smoke без авторизации:

- `/login` корректно отрисован;
- `/app/layout-studio/kora-liquid-station` без сессии перенаправляет на `/login`;
- Next overlay и console errors отсутствуют.

Supabase:

- project ref: `ztnycrchwxqczqbyegnp`;
- project URL: `https://ztnycrchwxqczqbyegnp.supabase.co`;
- `.env.local` существует только локально, игнорируется Git и не должен попадать в коммиты;
- Auth health отвечает HTTP 200;
- email и Google auth включены;
- Supabase CLI авторизован, но текущий management token не имеет privileges этого проекта; не заставлять владельца повторять уже выполненный login;
- production schema/migrations не менялись.

Security:

- sealed full scan коммита `91fe597`: scan `32327e4f-5575-45f1-8797-6f6013c205c5`, 675/675 items, 0 findings, 0 warnings;
- поздние diff scans `48479841-1e66-48e3-8fc6-277a4be13e18` и `8bf7668d-2573-4963-b9a5-8ddc285772f8` не нашли правдоподобных candidates, но не были sealed из-за ошибки плагина `scan.target.snapshotDigest: expected a non-empty string`;
- это ошибка финализации инструмента, а не обнаруженная уязвимость; нельзя заявлять, что финальный diff scan sealed.

## 4. Что ещё не завершено

`EXTERNAL_HOLD` — нужны реальные KORA-обмеры:

- LS-AT-002, 012–015, 091–092;
- чистая высота помещения (сейчас assumption 3000 мм);
- высота, рама и направление открывания двери;
- site verification абсолютной оси колонны;
- полный rear equipment set-out;
- central sink set-out;
- interaction/first-frame benchmarks после финального set-out.

`AUTH_BROWSER_HOLD` — нужна реальная пользовательская сессия ArchiDom:

- LS-AT-020, 040–043, 050–054, 070–077, 094;
- полный authenticated browser E2E редактора, persistence и exact-version exports ещё не проведён.

Остаются `PARTIAL/UNVERIFIED`:

- LS-AT-026 — SVG golden evidence;
- LS-AT-044 — camera reset polish/evidence.

Следовательно, модуль является технически собранным release candidate, но пока не production-ready и не разрешён к merge.

## 5. Следующий порядок работы

1. Проверить branch/HEAD/status и перечитать этот handoff, audit и acceptance ledger.
2. Использовать существующую реальную ArchiDom user session; не просить владельца повторять Supabase login без нового доказанного блокера.
3. Провести authenticated browser E2E: загрузка KORA, 2D/3D, edits, locks, conflict/idempotency, undo/redo, reload, checkpoint/version publish, immutable exact-version exports.
4. Сохранить evidence: screenshots, console/network log, export files/hashes/manifest и performance/GPU/memory observations.
5. Получить недостающие KORA-обмеры, обновить fixture и acceptance evidence; assumptions не выдавать за verified measurements.
6. Добавить SVG golden и доказательство camera reset.
7. Повторить lint, typecheck, полный test, build, npm audit и export verification.
8. Повторить независимый security diff scan после исправления плагина либо оформить честный альтернативный security report; не подменять sealed status.
9. Обновлять ledger в PASS только при наличии воспроизводимого evidence. Добиться 100% P0 PASS.
10. Провести повторный независимый audit. Только затем запросить отдельное решение Selena о переводе PR из draft и production merge.

## 6. Первые команды нового чата

```bash
cd /private/tmp/archidom-layout-studio-continuation
git status --short
git branch --show-current
git rev-parse HEAD
git log --oneline -10
rg -n ',(UNVERIFIED|PARTIAL|EXTERNAL_HOLD|AUTH_BROWSER_HOLD|FAIL|BLOCKED),' docs/product-intelligence/layout-studio-mvp/implementation/ACCEPTANCE_LEDGER_2026-08-06.csv
npm run lint
npm run typecheck
npm run test
npm run build
npm audit
```

## 7. Готовое ТЗ / prompt для нового чата

```text
Продолжай ArchiDom Layout Studio M2 автономно в ветке codex/archidom-layout-studio-m2.

Сначала прочитай полностью:
- AGENTS.md;
- docs/product-intelligence/layout-studio-mvp/implementation/NEW_CHAT_HANDOFF_2026-08-06.md;
- docs/product-intelligence/layout-studio-mvp/implementation/CONTINUATION_TRANSFER_AUDIT_2026-08-06.md;
- docs/product-intelligence/layout-studio-mvp/implementation/ACCEPTANCE_LEDGER_2026-08-06.csv;
- docs/product-intelligence/adr/0006-native-layout-studio-m2-research-gate.md.

Работай автономно и не жди подтверждения для безопасных действий внутри этой ветки. Не останавливайся до 100% P0 acceptance PASS либо объективного внешнего блокера, который нельзя устранить из доступного окружения. Не проси повторно Supabase login: он уже выполнен; management token лишь не имеет privileges проекта. Не раскрывай и не коммить ключи.

Модуль должен оставаться default-off. Не выполняй production merge, не меняй production schema и не переписывай timestamped migrations. PR остаётся draft до повторного независимого аудита и отдельного merge decision владельца Selena.

Главные незакрытые задачи: authenticated browser E2E с реальной пользовательской сессией; evidence для persistence/version/export/security; недостающие KORA-обмеры; SVG golden; camera reset evidence; повторный security diff scan после инструментальной ошибки snapshotDigest. Все изменения acceptance ledger подтверждай воспроизводимыми артефактами. После каждого code change повторяй релевантные тесты, а перед итогом — lint, typecheck, full tests, build, npm audit, browser/export/security audit.

В финале дай: branch и HEAD, PR URL, таблицу PASS/HOLD по P0/P1, ссылки на evidence, точный список оставшихся внешних блокеров и честный GO/NO-GO. Production merge без отдельного решения владельца запрещён.
```
