# Production schema observation — 16 июля 2026

## Статус

Этот документ начинался как ограниченное наблюдение через Data API. Позже в тот же день
получен authoritative schema/ledger snapshot из PostgreSQL catalog. Финальные выводы
ниже используют именно его; прежние Data API ограничения сохранены только как история
проверки.

```text
snapshot_contract = project-intelligence-production-schema/1.0
captured_at = 2026-07-16T07:10:24.609229+00:00
server_version = 17.6
migration_ledger = []
attachment_sha256 =
  a2f9a220399cd718cfb96fe2fb9b4ea6db824dac9e455eb7f24c3442ccd07a70
normalized_json_sha256 =
  ef8b0d3aafd319fe8779a70ce2fc6440fd0f2fc23bb58497cb90cd64d61561b0
```

## Первоначальный метод

Выполнен read-only запрос к Supabase PostgREST/OpenAPI с существующим server credential. Строки таблиц, контакты, документы и значения business data не запрашивались. В отчёт сохранены только имена доступных таблиц/колонок и HTTP status probes.

Data API observation не являлся полноценным PostgreSQL schema dump. Этот пробел теперь
закрыт catalog snapshot.

## Наблюдаемые public tables

- `answers`;
- `designers`;
- `events`;
- `project_participants`;
- `project_rooms`;
- `project_task_events`;
- `project_tasks`;
- `projects`;
- `proposals`;
- `risk_cards`;
- `studio_members`.

## Вывод по миграциям

### `0007_project_rooms.sql`

Её основные объекты доступны:

- `project_rooms`;
- `project_participants`;
- `project_tasks`;
- `project_task_events`.

Следовательно, `0007` либо эквивалентная schema change применена к production.

### `0009_project_room_workflow.sql`

В production `project_rooms` отсутствуют наблюдаемые колонки:

- `version`;
- `workflow_state`;
- `source_proposal_version`;
- `idempotency_key`;
- `updated_at`.

В `project_tasks` отсутствуют `version` и `workflow_state`; в `project_task_events` отсутствуют `event_version` и `idempotency_key`. Это подтверждает, что hardening changes из `0009` в наблюдаемой production schema не применены.

### `0008_concept_packs.sql` и `0005_rate_limits.sql`

Catalog snapshot подтверждает: обе таблицы и связанные объекты отсутствуют.

## Migration ledger

Authoritative ledger получен и пуст:

```json
[]
```

Это доказывает отсутствие зарегистрированной migration history, но не отсутствие
ручных schema changes. Поэтому production schema принята как фактическая точка adoption,
а numeric local files не помечаются individually applied.

## Финальная классификация

| Legacy migration | Production status |
|---|---|
| `0001–0004` | structurally present |
| `0005_rate_limits` | absent |
| `0006_team` | structurally present |
| exact HEAD `0007_project_rooms` | schema-equivalent present |
| `0008_concept_packs` | absent |
| worktree `0009_project_room_workflow` | absent; rejected as executable |

Active migration chain начинается новым timestamped production-adoption baseline. Он
проверяется только на clean disposable DB и не исполняется поверх существующей
production. После него разрешены additive private-schema Project Intelligence
migrations. Production history repair и rollout требуют отдельного approval.
