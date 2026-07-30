# Первый вертикальный срез

## Outcome

На одном живом проекте пользователь загружает источник, подтверждает извлечённое решение, меняет его в новой версии и получает воспроизводимый список затронутых объектов и обновлённый handoff.

## Happy path

1. Пользователь создаёт project и areas.
2. Загружает PDF или transcript.
3. Система создаёт Source, checksum и fragments с locator.
4. Extraction создаёт requirement/decision revisions со статусами `extracted` или `interpreted` и evidence links.
5. Пользователь подтверждает или отклоняет каждую ревизию.
6. Подтверждённый набор публикуется как Project Version 1.
7. Пользователь изменяет одно decision и указывает причину.
8. Система создаёт Version 2 и diff.
9. Impact engine находит зависимые item/deliverable по graph edges.
10. Пользователь рассматривает impacts.
11. Система экспортирует handoff со ссылками на источники, версиями и unresolved impacts.

## P0 UI

- Source list и ingestion status;
- side-by-side source fragment / extracted claim;
- Confirm / Reject / Edit;
- Project Graph table view по area и node kind;
- version diff;
- impact list с dependency path;
- export action и история экспортов.

Графическая canvas-визуализация не нужна для P0.

## Acceptance criteria

### Source and provenance

- один и тот же файл с тем же checksum не создаёт дубликат в рамках project;
- каждый extracted/interpreted AI-node имеет кликабельный locator;
- потерянный/недоступный fragment не позволяет подтвердить AI-node без явного warning;
- AI не может записать human status.

### Versions

- опубликованная версия immutable;
- edit подтверждённого decision создаёт новую revision и draft version;
- diff показывает старое и новое значение, actor, timestamp и reason;
- rollback создаёт новую версию, а не переписывает историю.

### Change impact

- результаты одинаковы при повторном запуске на одном graph/version pair;
- каждый impact содержит changed node, impacted node и полный path;
- non-propagating edge не добавляет impact;
- cycle не вызывает бесконечный обход;
- cross-project edge отклоняется до расчёта;
- пользователь может отметить impact resolved/not applicable с audit event.

### Export

- export содержит project/version identifier;
- claims содержат source references;
- unresolved impacts перечислены явно;
- повторный export одной версии идемпотентен либо создаёт новый render с тем же content hash.

## Non-goals

- CRM, accounting и payments;
- CAD/3D editing;
- полноценная закупка;
- универсальный task manager;
- автоматическое исправление всех затронутых документов;
- одновременный полноценный workflow Studio и Renovation.

## Метрики среза

- время от загрузки до первой подтверждённой версии;
- доля AI-ревизий с валидным evidence;
- доля confirmed/rejected/edited;
- precision impact list по оценке пользователя;
- время от изменения decision до нового handoff;
- запуск второго живого проекта той же organization.
