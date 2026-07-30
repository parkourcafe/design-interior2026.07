# ArchiDom — route/entity map

Дата: 2026-07-23. Карта отражает исполняемый код текущей ветки, а не желаемую архитектуру.

## Маршруты и роли

| Route | Доступ/роль | Handler/port | Основные сущности | Состояние |
|---|---|---|---|---|
| `/` | public | server page | landing | working/static |
| `/login`, `/auth/callback` | public→Auth | Supabase Auth | auth user | working with env |
| `/dashboard` | studio member | `createProject` | projects, events | M1 write path |
| `/i/[token]` | token client | intake APIs | projects, answers, risk_cards, Storage | M1 public flow |
| `/b/[token]` | token viewer | server page/admin lookup | projects/passport | M1 share view |
| `/dashboard/projects/[id]` | studio member/RLS | server actions | passport, answers, risks | M1 Review Board |
| `/dashboard/projects/[id]/proposal` | studio member/RLS | proposal actions | proposals, events | M1 proposal |
| `/p/[public_token]` | token client | respond API | proposals, projects, events | public proposal/response |
| `/dashboard/projects/[id]/concept-pack` | studio member/RLS | concept action | concept_packs | disconnected from authoritative migration |
| `/dashboard/projects/[id]/room` | studio member/RLS | room actions | project_rooms, participants, tasks, events | legacy post-sale task room |
| `/room/[access_token]` | participant token | admin lookup/status API | participants, tasks, task events | token workspace; no expiry/revoke UI found |
| `/dashboard/projectceo` | authenticated human | live read port/RPC | org/project/package/access | ProjectCEO portfolio |
| `/dashboard/projectceo/projects/[projectId]` | scoped participant | read port + command API | sources, decisions, selections, baseline, release, M4 | rich read/partial write workspace |
| `/projectceo/invitations/[token]` | authenticated invitee | accept RPC | invitation/membership | supported |
| `/projectceo/guest/[token]` | opaque token | anon RPC | exact release projection | supported read-only |
| `/projectceo-qa/[role]` | local fixture only | mock port | Kora static fixture | MOCK_OR_STATIC; forbidden in production factory |

## API/actions

- M1: `/api/client/create`, `/api/intake/start|submit|upload`, proposal respond, custom-question/plan helpers, dashboard server actions.
- Legacy post-sale: `/api/project-room/task-status`.
- ProjectCEO reads: `/api/projectceo/portfolio`, `/api/projectceo/projects/[projectId]`.
- ProjectCEO commands: `/api/projectceo/commands`, invitation accept. Supported commands include invitation/grant lifecycle, distribution/ack, change/impact, photo review and milestone acceptance. `register_source`, `review_source`, `review_selection`, `publish_baseline`, `publish_release`, `build_handover` are explicitly unavailable.

## Сущности

Legacy public: `designers`, `projects`, `answers`, `risk_cards`, `proposals`, `events`, `studio_members`, `project_rooms`, `project_participants`, `project_tasks`, `project_task_events`; private Storage bucket `client-uploads`. UI также обращается к `concept_packs`, но authoritative timestamped baseline её не создаёт.

Project Intelligence core: organizations/members/capabilities, workflows, sources/fragments, graph nodes/revisions/edges, reviews/evidence, project versions, change sets/impacts, logical handoffs, commands/audit.

ProjectCEO foundation: project packages/memberships/capabilities, invitations, guest grants, source inventory/protected metadata/materializations/ingestions, command/audit.

Product Brain: claim revision descriptors, evidence refs, price observations, approval packages/items/events, project baselines/refs/approvals, production package versions/refs, release artifacts/distributions/acknowledgements.

Thin M4: change requests/roots, impact runs/paths/reviews, milestones/areas, photo evidence/reviews, milestone acceptances, handover documents/construction handovers/refs.

## Связи и разрывы M1→M2→M3

```text
M1 public.projects + passport JSON
  ├─ proposal/version=1
  ├─ legacy concept_packs (missing authoritative DDL)
  └─ compatibility project metadata bridge
       ↓ same project UUID where enrolled
ProjectCEO Organization → Project → Packages
  ├─ Product Brain decisions/selections/approvals
  └─ Sources → exact revisions → baseline → package version → release
```

Не подключено к основному пути:

- M1 accepted proposal не создаёт immutable Contracted Project Passport в Product Brain.
- legacy Concept Pack не создаёт Decision/Selection/Approval revision.
- approved selection не создаёт M3 source/specification/document.
- M3 release не отражается в legacy M1 project/room.
- Project Check readiness state не найден.
- Mock Kora port используется QA harness, но deployable production factory выбирает live port.
