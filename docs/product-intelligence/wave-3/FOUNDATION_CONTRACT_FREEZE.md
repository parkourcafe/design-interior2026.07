# ProjectCEO RU — Foundation Contract Freeze

Дата: 17 июля 2026 года.
Статус: **frozen for Wave 3 Foundation**.
Основание: Gate 0 seal `fa231f5`.

Этот документ фиксирует общие invariants до принятия DB3. Агенты могут расширять
DTO additive-полями, но не менять смысл identity, scope и authorization.

## 1. Organization и Project enrollment

1. Один `public.projects.id` может быть enrolled максимум в одну ProjectCEO
   Organization.
2. Enrollment создаёт или возвращает один и тот же logical result:
   Organization, owner membership, Project binding, owner project membership,
   capability preset, root package и workflow root.
3. Повтор с тем же project/owner/idempotency key возвращает существующий result.
4. Повтор с другим idempotency key, но тем же допустимым logical request, не
   создаёт второй Organization/Project/root package.
5. Попытка связать enrolled project с другой Organization возвращает conflict.
6. Concurrent enrollment имеет одного победителя; loser получает существующий
   result либо controlled conflict, но не partial rows.
7. Actor, organization, owner identity, timestamps и audit actor выводятся из
   authenticated DB/session context.
8. Suspension или удаление membership не освобождает project для скрытого
   re-enrollment в другую Organization.

## 2. Package identity

`ProjectPackage` — стабильная authorization и delivery identity, а не room/task.

Минимальный контракт:

```text
id uuid
organization_id uuid
project_id uuid
stable_key text
kind 'project_root' | 'work_package'
parent_package_id uuid | null
name text
status 'active' | 'archived'
created_at timestamptz
```

Invariants:

1. Ровно один `project_root` на Project.
2. `stable_key` immutable и unique внутри Project.
3. Parent и child принадлежат одной Organization и одному Project.
4. Циклы запрещены.
5. Package не подменяет Floor/Zone/Room/Discipline: это Project Graph nodes и
   filters/bindings.
6. `package_id = null` в access scope означает весь exact Project, но никогда
   другие проекты Organization.
7. Package-scoped grant даёт доступ только exact package и явно опубликованным
   артефактам этого package. Доступ к parent/sibling не наследуется.
8. Published version/release всегда хранит exact `package_id`, version identity и
   semantic hash.

## 3. Human roles и capabilities

Organization membership само по себе не даёт Project access. Каждая human
операция требует active Organization membership, active ProjectMembership и
capability в exact Project/package scope.

| Capability | Owner/lead | Architect/designer/PM | Builder/contractor | Client approver | Supplier/guest |
|---|---:|---:|---:|---:|---:|
| view_project | yes | yes | published scope | published scope | published package |
| manage_project | yes | no | no | no | no |
| manage_access | yes | no | no | no | no |
| register_source | yes | yes | limited evidence | no | no |
| review_source | yes | yes | no | no | no |
| review_claim | yes | yes | no | no | no |
| create_selection | yes | yes | propose only | no | no |
| review_selection | yes | yes | no | yes | no |
| publish_baseline | yes | yes | no | no | no |
| publish_release | yes | yes | no | no | no |
| distribute_release | yes | yes | no | no | no |
| acknowledge_release | yes | yes | yes | yes | optional exact package |
| revise_decision | yes | yes | propose change | request change | no |
| create_change | yes | yes | yes | yes | no |
| review_change_impact | yes | yes | comment only | comment only | no |
| upload_photo_evidence | yes | yes | yes | no | no |
| review_milestone | yes | yes | submit only | yes | no |
| view_audit | yes | yes | own/published events | own/published events | no |

Rules:

- presets expand server-side into capabilities;
- UI role labels do not authorize actions;
- custom role builder is not P0;
- executor/worker roles are non-human, `NOLOGIN` where applicable, and never
  receive human RPC;
- inactive membership or suspended Organization denies immediately;
- revoke denies immediately even if an old UI session remains open.

## 4. Invitation recipient binding

### Team invitation

1. Create command receives recipient email only through authenticated server
   adapter.
2. Adapter normalizes email, generates at least 256 bits of randomness and returns
   raw token once.
3. DB stores token digest, protected normalized recipient identity, scope, role,
   expiry and revoke state.
4. Raw token, email and signed link do not enter structured audit.
5. Acceptance requires:
   - valid unexpired/unrevoked digest;
   - authenticated user;
   - `email_confirmed_at`/equivalent verified identity;
   - normalized authenticated email equals protected recipient email.
6. Acceptance does not trust email, user id, role, organization, project or
   package from request JSON.
7. Acceptance is one-time and replay returns the same membership result.
8. Reissue rotates digest and invalidates the previous link.
9. Legacy registration with `email_confirm: true` is not proof of recipient
   ownership and cannot accept ProjectCEO invitations.

### Guest AccessGrant

1. Guest link may be delivered through WhatsApp/email but is not team identity.
2. DB stores only digest.
3. Grant is exact Project/package/release scoped, read-only unless one explicit
   acknowledgement capability is present.
4. Grant has mandatory expiry and revoke; P0 maximum TTL is seven days.
5. Revoke/expiry denies immediately.
6. Guest cannot enumerate Organization, other projects, packages, members, source
   registry or private audit.

## 5. Storage authorization

Canonical key:

```text
project-intelligence/ru/{organization_uuid}/{project_uuid}/sources/{sha256_hex}/{role}.{ext}
```

- key is derived server-side;
- arbitrary object path is rejected;
- original filename/PII is absent from key and audit;
- private bucket, `upsert:false`;
- write authorization precedes upload;
- read authorization binds exact stored object to exact project/package scope;
- signed URL TTL is at most 15 minutes;
- MIME, extension and size are allowlisted;
- retry by identical content is deterministic;
- DB failure after upload produces best-effort cleanup and orphan reconciliation.

## 6. Versioned delivery envelope

Все Foundation read/mutation DTO используют envelope:

```text
contractVersion
requestId
data | error
```

Error содержит stable machine code и безопасное RU-facing message mapping, но не
SQL, token, email, original filename, signed URL или private relation name.

Минимальные machine codes:

```text
unauthenticated
identity_unverified
forbidden
not_found
expired
revoked
stale_state
idempotency_conflict
scope_conflict
unsupported_source
validation_failed
rate_limited
internal_error
```
