-- Platform foundation A5: persistence каталога воркфлоу (Фаза 2).
--
-- ЧТО ЭТО. Реестр шаблонов из `REMHAOS_WORKFLOW_CATALOG_v1.md` — таблица
-- с id, модулем-владельцем, статусом авторизации, сводкой и шагами (jsonb)
-- там, где каталог их определяет (WF-M1-001: 8 шагов; WF-TG-001: 7 шагов;
-- M2/M3/M4 в каталоге описаны сводкой — steps = []).
--
-- ЧЕГО ЗДЕСЬ НЕТ (осознанно, ТЗ A5): исполнения шаблонов — только реестр
-- и валидация формы. Шаги каталога — действия БУДУЩИХ исполнений; их
-- связи с Action Registry (A3) валидируются контрактом формы, а
-- содержательное сопоставление — следующий этап.
--
-- ФОРМА. Приватная схема, RLS force, revoke-all, internal-owner policy,
-- владелец pi_table_owner. Чтение — стабильная RPC-дверь для членов
-- проекта (view_project); запись — только миграции/оператор (каталог —
-- подписанный документ, данные — его отражение; изменение = новая
-- миграция, как весь канон).

begin;

create table projectceo_platform.workflow_templates (
  template_id text not null
    check (template_id ~ '^WF-[A-Z0-9]+-[0-9]{3}$'),
  version text not null default 'v1',
  owner_module text not null
    check (owner_module in ('m1', 'm2', 'm3', 'm4', 'tg_bridge')),
  -- Статус авторизации из каталога: sprint_1 | authorized | partially_authorized.
  auth_status text not null
    check (auth_status in ('sprint_1', 'authorized', 'partially_authorized')),
  basis text not null
    check (char_length(btrim(basis)) between 1 and 200),
  summary text not null
    check (char_length(btrim(summary)) between 1 and 500),
  steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(steps) = 'array'),
  created_at timestamptz not null default now(),
  primary key (template_id, version)
);

alter table projectceo_platform.workflow_templates enable row level security;
alter table projectceo_platform.workflow_templates force row level security;
revoke all on table projectceo_platform.workflow_templates
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter table projectceo_platform.workflow_templates owner to pi_table_owner;
create policy workflow_templates_internal_owner
  on projectceo_platform.workflow_templates
  for all to pi_table_owner using (true) with check (true);

-- Форма шагов — триггером (CHECK не держит подзапросы): каждый элемент —
-- объект с непустым action и непустым costClass.
create function projectceo_platform.guard_workflow_steps_shape()
returns trigger
language plpgsql
as $function$
declare
  step jsonb;
begin
  if new.steps = '[]'::jsonb then
    return new;
  end if;
  for step in select jsonb_array_elements(new.steps) loop
    if jsonb_typeof(step) <> 'object'
      or coalesce(btrim(step ->> 'action'), '') = ''
      or coalesce(btrim(step ->> 'costClass'), '') = '' then
      raise exception using
        errcode = '55000',
        message = 'PROJECTCEO_PLATFORM_WORKFLOW_STEP_SHAPE_INVALID';
    end if;
  end loop;
  return new;
end
$function$;

create trigger workflow_templates_steps_shape
  before insert or update on projectceo_platform.workflow_templates
  for each row execute function projectceo_platform.guard_workflow_steps_shape();

-- === Seed: ровно то, что определяет каталог v1 ==============================

insert into projectceo_platform.workflow_templates (
  template_id, owner_module, auth_status, basis, summary, steps
) values
(
  'WF-M1-001', 'm1', 'sprint_1',
  'WORKFLOW_CATALOG_v1 §WF-M1-001 (Sprint 1)',
  'Client Intake to Issued Proposal: бриф → факты → вопросы → паспорт → риски → scope → гонорар → КП → выдача',
  '[
    {"no": 1, "action": "extract_client_brief",        "costClass": "metered_ai",         "humanGate": "fact review",              "output": "ProjectFact[]"},
    {"no": 2, "action": "generate_clarifying_questions","costClass": "metered_ai",         "humanGate": "send/review",              "output": "OpenQuestion[]"},
    {"no": 3, "action": "build_project_passport",       "costClass": "free_deterministic", "humanGate": "confirm facts",            "output": "passport read model"},
    {"no": 4, "action": "generate_risk_register",       "costClass": "hybrid/metered_ai",  "humanGate": "accept/reject risks",      "output": "Risk[]"},
    {"no": 5, "action": "build_scope_draft",            "costClass": "free_deterministic", "humanGate": "internal review",          "output": "ScopeItem[]"},
    {"no": 6, "action": "calculate_fee",                "costClass": "free_deterministic", "humanGate": "owner/studio approval",    "output": "fee range"},
    {"no": 7, "action": "generate_proposal_draft",      "costClass": "metered_ai",         "humanGate": "proposal approval",        "output": "ProposalVersion draft"},
    {"no": 8, "action": "issue_proposal",               "costClass": "free_deterministic", "humanGate": "RELEASE_AUTHORIZED",       "output": "issued proposal"}
  ]'::jsonb
),
(
  'WF-M2-001', 'm2', 'authorized',
  'WORKFLOW_CATALOG_v1 §WF-M2-001 (AUTHORIZED BY A4, 08.08.2026)',
  'Passport to Design Freeze: концепции → три варианта → влияние на материалы/бюджет → одобрение клиента → Design Freeze',
  '[]'::jsonb
),
(
  'WF-M3-001', 'm3', 'authorized',
  'WORKFLOW_CATALOG_v1 §WF-M3-001 (AUTHORIZED BY A5, 09.08.2026, P0)',
  'Design Intent to Documentation Release: решения → комплект листов → QA/конфликты → спецификации → выпуск пакета → авторизация релиза',
  '[]'::jsonb
),
(
  'WF-M4-001', 'm4', 'partially_authorized',
  'WORKFLOW_CATALOG_v1 §WF-M4-001 (PARTIALLY AUTHORIZED BY A6 — INCREMENT 1 ONLY)',
  'Issued Package to Stage Acceptance: baseline → site tasks → RFI/отклонения → изменения → инспекция → доказательства → приёмка; stage acceptance НЕ авторизован',
  '[]'::jsonb
),
(
  'WF-TG-001', 'tg_bridge', 'authorized',
  'WORKFLOW_CATALOG_v1 §WF-TG-001 (AUTHORIZED BY A7, 11.08.2026, DEC-031, P0 ONLY)',
  'Telegram Chat Bridge (M3 → M4): связь → биндинг → ingest → кандидат → человек решает → официальная команда → уведомление',
  '[
    {"no": 1,   "action": "link_telegram_identity",      "costClass": "free_deterministic", "humanGate": "вход в RemHaOS + одноразовый intent", "output": "ChannelIdentityLink"},
    {"no": 2,   "action": "bind_project_chat",           "costClass": "free_deterministic", "humanGate": "manage_project_integrations + admin группы", "output": "ProjectChannelBinding"},
    {"no": "2a","action": "terminate_pending_binding",   "costClass": "free_deterministic", "humanGate": null, "output": "ProjectChannelBinding suspended/revoked"},
    {"no": 3,   "action": "ingest_channel_update",       "costClass": "free_deterministic", "humanGate": null, "output": "ChannelEvent (+ ChannelAttachment)"},
    {"no": 4,   "action": "extract_candidate",           "costClass": "metered_ai",         "humanGate": null, "output": "ProjectInboxCandidate (pending)"},
    {"no": 5,   "action": "review_candidate",            "costClass": "free_deterministic", "humanGate": "человек в RemHaOS", "output": "подтверждён/отклонён"},
    {"no": 6,   "action": "module_command",              "costClass": "по модулю",          "humanGate": "человеческая сессия", "output": "ChangeRequest и др."},
    {"no": 7,   "action": "notify_release_distributed",  "costClass": "free_deterministic", "humanGate": null, "output": "сообщение в чат + deep link"}
  ]'::jsonb
);

-- === Дверь чтения ===========================================================

create function projectceo_platform_api.list_workflow_templates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_has_project boolean;
  v_organization_id uuid;
  v_data jsonb;
begin
  -- Каталог читают члены проектов; на проект-независимом стенде (до
  -- зачисления) реестр не отдаётся — дверь требует членства хотя бы в
  -- одном проекте организации каталога... Каталог один на инсталляцию:
  -- достаточно факта активного членства.
  select exists (
    select 1
    from projectceo_foundation.project_memberships m
    where m.user_id = project_intelligence._request_user_id()
      and m.status = 'active'
  ) into v_has_project;
  if not v_has_project then
    perform projectceo_product._raise(
      'P1103', 'forbidden', '{"reason":"MEMBERSHIP_REQUIRED"}'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'templateId', t.template_id,
    'version', t.version,
    'ownerModule', t.owner_module,
    'authorization', t.auth_status,
    'basis', t.basis,
    'summary', t.summary,
    'steps', t.steps
  ) order by t.template_id), '[]'::jsonb) into v_data
  from projectceo_platform.workflow_templates t;

  return jsonb_build_object('templates', v_data);
end
$function$;

alter function projectceo_platform_api.list_workflow_templates()
  owner to pi_table_owner;
revoke all on function projectceo_platform_api.list_workflow_templates()
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
grant execute on function projectceo_platform_api.list_workflow_templates()
  to authenticated;

-- === Guard ==================================================================

do $guard$
declare
  v_count integer;
begin
  select count(*) into v_count
  from projectceo_platform.workflow_templates;
  if v_count <> 5 then
    raise exception 'PROJECTCEO_PLATFORM_WORKFLOW_TEMPLATES_COUNT:%', v_count;
  end if;

  if has_function_privilege(
    'anon',
    'projectceo_platform_api.list_workflow_templates()',
    'execute'
  ) then
    raise exception 'PROJECTCEO_PLATFORM_TEMPLATES_REACHABLE_BY_ANON';
  end if;
end
$guard$;

commit;
