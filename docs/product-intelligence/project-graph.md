# Project Graph v0.1

## 1. Назначение

Project Graph отвечает на четыре вопроса:

1. Откуда взялось утверждение?
2. Кто и когда его подтвердил?
3. Какая версия была действующей в конкретный момент?
4. Что должно быть перепроверено, если решение изменилось?

## 2. Канонические сущности

- `Organization`, `Membership`, `Client`, `Project`;
- `Area` — помещение, зона или иерархическая область;
- `Source`, `SourceFragment`;
- `GraphNode` типов `requirement`, `assumption`, `decision`, `risk`, `deliverable`, `item`, а также служебных `area`, `source`, `approval`;
- `GraphNodeRevision`;
- `GraphEdge`;
- `EvidenceLink`;
- `ProjectVersion`, `ChangeSet`;
- `Approval`, `ChangeImpact`, `AuditEvent`.

`Room` является `Area(type='room')`. Это позволяет одинаково описывать дом, этаж, помещение, стену или функциональную зону без отдельных несовместимых моделей.

## 3. Рекомендуемая relational model

### Projects and areas

```text
organizations(id, edition, region, settings)
organization_members(id, organization_id, user_id, role)
clients(id, organization_id, display_name, contact_encrypted)
projects(id, organization_id, client_id, status, current_version_id)
areas(id, project_id, parent_area_id, area_type, stable_key, name)
```

### Immutable sources

```text
sources(
  id, project_id, source_kind, storage_key, media_type,
  checksum, original_name, ingestion_status, created_at
)

source_fragments(
  id, source_id, fragment_kind, locator_json,
  extracted_text, checksum, created_at
)
```

Примеры `locator_json`:

- PDF: `{ "page": 12, "bbox": [0.1, 0.2, 0.7, 0.35] }`;
- transcript: `{ "start_ms": 185000, "end_ms": 193500, "speaker": "client" }`;
- email: `{ "message_id": "…", "paragraph": 4 }`;
- spreadsheet: `{ "sheet": "FF&E", "cell_range": "B17:H17" }`;
- image: `{ "bbox": [120, 80, 410, 260] }`.

### Stable nodes and append-only revisions

```text
graph_nodes(
  id, project_id, node_kind, area_id, stable_key,
  current_revision_id, created_at, archived_at
)

graph_node_revisions(
  id, node_id, project_version_id, revision_no,
  title, payload_json, origin,
  claim_status, unknown_reason,
  created_by, created_at, replaces_revision_id
)

evidence_links(
  id, node_revision_id, source_fragment_id,
  evidence_role, confidence, created_at
)
```

`payload_json` валидируется Zod-схемой, версионированной по `node_kind`. В P0 это быстрее typed-table-per-kind и сохраняет общую механику графа. После стабилизации частые поля могут получить materialized projections или отдельные detail tables без изменения идентичности node.

### Edges and versions

```text
graph_edges(
  id, project_id, from_node_id, to_node_id,
  relation, valid_from_version_id, valid_to_version_id,
  created_at
)

project_versions(
  id, project_id, version_no, base_version_id,
  status, label, created_by, created_at, approved_at
)

change_sets(
  id, project_id, from_version_id, to_version_id,
  reason, initiated_by, created_at
)

change_impacts(
  id, change_set_id, changed_node_id, impacted_node_id,
  path_json, reason_code, status, reviewed_by, reviewed_at
)
```

## 4. Claim status

Единый статус происхождения/проверки AI-вывода:

| Статус | Смысл |
|---|---|
| `extracted` | содержится в источнике напрямую |
| `interpreted` | вывод сделан из одного или нескольких фрагментов |
| `unknown` | данных недостаточно; причина обязательна |
| `human_confirmed` | человек подтвердил конкретную ревизию |
| `human_rejected` | человек отклонил конкретную ревизию |

`origin` хранится отдельно: `human`, `ai`, `import`, `system` и описывает происхождение содержимого ревизии, а не автора review. Поэтому AI-origin revision может получить `human_confirmed` или `human_rejected`, но только через отдельное human-review действие с actor, timestamp и явной ссылкой на эту revision. AI-процесс не имеет права выполнить такое действие или подставить human actor.

## 5. Связи

Направление dependency-связей: **зависимый узел → узел, от которого он зависит**.

| Relation | Пример | Propagates change |
|---|---|---|
| `depends_on` | deliverable → item | да |
| `derived_from` | requirement → source claim | да |
| `specified_by` | item → decision | да |
| `satisfies` | deliverable → requirement | да |
| `applies_to` | requirement → area | нет |
| `contains` | deliverable → section/item | нет по умолчанию |
| `conflicts_with` | risk ↔ decision | нет; создаёт review signal отдельно |
| `references` | note → source | нет |

Change-impact проходит обратным направлением: если изменился target dependency, затронуты входящие dependents.

## 6. Инварианты

1. Все nodes и edges одной операции принадлежат одному project.
2. `stable_key` уникален внутри `(project_id, node_kind)`.
3. `revision_no` монотонен внутри node; прошлые ревизии immutable.
4. `current_revision_id` принадлежит тому же node.
5. AI-ревизия `extracted` или `interpreted` имеет минимум один evidence link.
6. `unknown` имеет `unknown_reason` и не маскируется пустым текстом.
7. Human status имеет human actor и timestamp.
8. SourceFragment immutable и принадлежит Source того же project.
9. GraphEdge не может ссылаться на node другого project.
10. Одна активная semantic edge с одинаковыми `(from, to, relation)`.
11. Published/approved ProjectVersion не изменяется; корректировка создаёт следующую версию.
12. Impact record всегда содержит воспроизводимый path по существовавшим в версии edges.

## 7. Алгоритм change-impact

1. Построить diff ревизий между `from_version` и `to_version`.
2. Выделить изменённые nodes и поля.
3. Для каждого changed node обойти входящие edges, у которых policy `propagates_change=true`.
4. Продолжать обход до конца dependency chain, не заходя повторно в node.
5. Сохранить кратчайший воспроизводимый path.
6. Присвоить impacted node состояние `needs_review`; не менять его бизнес-данные автоматически.
7. После human review отметить impact как `accepted`, `resolved` или `not_applicable`.

Алгоритм детерминирован. AI разрешено:

- предложить связи до подтверждения;
- объяснить найденный path человеческим языком;
- предложить вопросы для перепроверки.

AI запрещено скрыто добавлять затронутые объекты без сохранённой связи.

## 8. Минимальный пример

```text
Decision: заменить натуральный камень на кварцевый агломерат
  ↑ specified_by
Item: столешница кухни
  ↑ depends_on
Deliverable: FF&E / finish schedule кухни
  ↑ depends_on
Deliverable: бюджетная ведомость
```

Изменение Decision создаёт impacts для Item и обоих Deliverables. Пользователь видит не «AI считает», а конкретный dependency path и исходную версию решения.
