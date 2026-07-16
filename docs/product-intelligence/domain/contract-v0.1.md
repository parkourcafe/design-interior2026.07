# Project Intelligence Domain v0.1

Статус: frozen candidate для integration review. Контракт pure TypeScript не зависит от
Supabase, Next.js, UI, edition, region или AI provider.

Машиночитаемый manifest: [`contract-v0.1.json`](./contract-v0.1.json).

## 1. Модель идентичности и версии

`ProjectGraphNode` — только стабильная идентичность: `id`, `projectId`, `kind`,
`stableKey`, `currentRevisionId`. Изменяемое содержание в stable node отсутствует.

`GraphNodeRevision` — отдельное immutable содержание: `id`, `nodeId`, `projectId`,
`title`, JSON payload, content `origin`, исходный claim status и optional
`replacesRevisionId`.

`HumanReview` — отдельное действие над exact `targetRevisionId`. Оно хранит decision,
human actor и server timestamp. Review не меняет `origin` revision и не переписывает её
payload. `ProjectGraphSnapshot` задаёт точные `projectId` + `versionId` и набор active
nodes/revisions/edges/sources/evidence/reviews для этой версии.

Полные `ClaimStatus` включают `human_confirmed`/`human_rejected`, но immutable revision
хранит только исходный `RevisionClaimStatus`: `extracted`, `interpreted` или `unknown`.
Human status является эффективным результатом отдельного `HumanReview`. Это устраняет
необходимость менять уже существующую revision после review.

## 2. Source и provenance

Цепочка замкнута так:

```text
ProjectSource
  ← SourceFragment(sourceId + typed locator)
  ← EvidenceLink(sourceFragmentId → nodeRevisionId)
  → GraphNodeRevision
  → ProjectGraphNode.currentRevisionId
```

Source, Fragment, Revision и Evidence должны принадлежать одному project. AI-origin
revision со статусом `extracted` или `interpreted` требует evidence на эту exact revision
до и после human review. `unknown` требует непустой `unknownReason`.

## 3. Locator contract

| Kind | Поля | Runtime rules |
|---|---|---|
| `pdf` | `page`, optional normalized `bbox` | page 1-based; bbox ordered, 0…1 |
| `transcript` | `startMs`, `endMs`, optional speaker | целые ms, start ≥ 0, end > start; применяется и к audio transcript |
| `image` | coordinate system + bbox | `pixel` ≥ 0 либо `normalized` 0…1; ordered |
| `spreadsheet` | sheet + cell range | оба identifiers непустые |
| `email` | message ID + paragraph/part | ID непустой; минимум один addressable part |
| `plain_text` | start/end character | Unicode code-point offsets, start ≥ 0, end > start |

`validateSourceLocator(unknown)` возвращает `DomainResult<SourceLocator>`, а не бросает
неструктурированную ошибку. Unknown kind, invalid interval/page/bbox и empty identifiers
имеют stable codes и paths.

## 4. Graph validation

`validateProjectGraphSnapshot` возвращает детерминированно отсортированный список
`DomainIssue`. Проверяются:

- unique IDs и `(kind, stableKey)`;
- current revision принадлежит stable node;
- source/fragment/revision/evidence project closure;
- revision-specific AI evidence и unknown reason;
- review target, human actor, decision и ISO timestamp;
- edge endpoints, project boundary, self-edge, duplicate semantic edge;
- обязательный exact `versionId` snapshot.

Validation проверяет форму actor record, но не аутентифицирует пользователя. Caller обязан
получить actor ID из server-side identity context.

## 5. Human review transition

`reviewRevision(input)` различает `human_action` и `system_proposal`.

- confirm/reject разрешены только `human_action` с human actor;
- `targetRevisionId` должен совпасть с `expectedRevisionId`;
- expected revision должна оставаться current для stable node;
- AI-origin target требует revision-specific evidence;
- timestamp должен быть server-provided ISO timestamp with timezone;
- функция не мутирует snapshot и возвращает новый review record, target revision и
  effective `human_confirmed`/`human_rejected` status.

Persistence, authentication, authorization и append-only audit event остаются application
layer responsibilities.

## 6. Version diff

`diffProjectVersions(from, to)` сравнивает stable node snapshots одного project.

- added/removed/changed nodes имеют `impactRelevant: true`;
- JSON Pointer paths стабильны, escaped и отсортированы по Unicode code point;
- object key order не влияет на semantic equality; array order влияет;
- одинаковый revision ID с разным payload — `revision_immutability_violation`;
- новый revision ID с тем же semantic payload — `revision_transition`, пустой content
  diff и `impactRelevant: false`;
- `changedNodeIds` возвращает только impact roots.

Actor, timestamp, reason и from/to version lifecycle принадлежат application-level
ChangeSet/AuditEvent, а не pure `NodeVersionChange`.

## 7. Change impact

Dependency edge направлена `dependent → dependency`. Impact идёт обратно от изменённой
dependency к входящим dependents.

Propagating relations: `depends_on`, `derived_from`, `specified_by`, `satisfies`.
Остальные четыре relation не распространяют change.

`calculateChangeImpact` принимает exact `ProjectGraphSnapshot` и impact-relevant stable
node IDs. Для каждого результата возвращаются root, impacted node, distance, полный
node path и edge path. Выбирается кратчайший path; равные shortest paths разрешаются
явным Unicode code-point comparator по node path и edge IDs. Cycles и duplicate roots
безопасны. Входные arrays/objects не сортируются и не меняются на месте.

Persisted impact ID/status/from-to versions и review lifecycle добавляет application или
persistence adapter. LLM explanations не входят в domain result.

## 8. Structured errors

Validation/policy functions возвращают `DomainIssue[]`; diff/impact для invalid operation
бросают `DomainContractError` с `code`, optional `entityId` и `path`. Полный стабильный
allowlist находится в `DOMAIN_ERROR_CODES` и manifest.

## 9. Ordering

Любой public ordered output использует `compareCodePoints`. `localeCompare` и implicit
UTF-16 ordering не используются. Это гарантирует одинаковый byte order для shuffled
inputs и non-ASCII identifiers во всех deployment cells.

## 10. Public breaking changes до freeze

Внешних runtime consumers текущего модуля в репозитории не найдено. Поэтому ambiguous
compatibility aliases не оставлены:

- прежний `ProjectGraphNode` с revision/content fields заменён stable-only node;
- прежний `ProjectGraph` заменён versioned `ProjectGraphSnapshot`;
- `ClaimOrigin` заменён на `ContentOrigin`;
- `validateProjectGraph` заменён на `validateProjectGraphSnapshot`;
- AI-origin + human review теперь валидна; запрещён только AI/system review actor;
- diff получил `revision_transition` и `impactRelevant`;
- diff/impact invalid input имеет structured `DomainContractError`;
- impact требует exact versioned snapshot.

## 11. Required integrator adapters

Integrator должен отдельно реализовать:

1. persistence mapping stable node/revision/review/source/snapshot;
2. authenticated actor context и authoritative server timestamp;
3. ProjectVersion/ChangeSet enrichment вокруг pure diff;
4. persisted impact identity/lifecycle/from-to version pair;
5. выбор edges active для exact target version;
6. unavailable-evidence acknowledgement и audit event;
7. mapping synthetic Agent 3 fixtures к frozen public names.

Ни один из этих adapters не должен менять pure provenance, ordering или propagation
policy без нового contract decision.
