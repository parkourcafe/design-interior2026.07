-- Комплект подрядчика уровня 1 и подтверждение получения
-- (решение владельца 01.10.2026 после E2E-20261001-1531: вариант B — «Передать в
-- работу» одним действием дизайнера; уровень 1; суммы подрядчику не показываются).
--
--   * project_handover_kits — неизменяемый снимок того, что передано исполнителю
--     комнаты: версия принятого КП, её текст без стоимости, сводка паспорта без
--     контактов и бюджета, manifest файлов (имя, размер, SHA-256, место в Storage).
--     Один комплект на комнату; создаёт участник студии, только из принятого КП
--     этого же проекта. Это не «выпуск к стройке» (Released Production Package):
--     тот остаётся за путём M2→M3.
--   * project_handover_receipts — «Получил»: исполнитель по своей ссылке комнаты,
--     один раз на комплект (повтор идемпотентен). Пишет серверный маршрут по
--     токену участника; конечные пользователи записи не меняют и не удаляют.

begin;

create table public.project_handover_kits (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.project_rooms(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  proposal_id uuid not null references public.proposals(id) on delete restrict,
  proposal_version integer not null check (proposal_version > 0),
  proposal_sections jsonb not null check (jsonb_typeof(proposal_sections) = 'array'),
  passport_summary jsonb not null check (jsonb_typeof(passport_summary) = 'object'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'array' and jsonb_array_length(manifest) between 1 and 40),
  created_by uuid not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  constraint project_handover_kits_one_per_room unique (room_id)
);

create table public.project_handover_receipts (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references public.project_handover_kits(id) on delete restrict,
  participant_id uuid not null references public.project_participants(id) on delete restrict,
  received_at timestamptz not null default pg_catalog.statement_timestamp(),
  constraint project_handover_receipts_once unique (kit_id, participant_id)
);

alter table public.project_handover_kits enable row level security;
alter table public.project_handover_kits force row level security;
alter table public.project_handover_receipts enable row level security;
alter table public.project_handover_receipts force row level security;

create policy project_handover_kits_studio_select
  on public.project_handover_kits for select to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_handover_kits.project_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  );

create policy project_handover_kits_studio_insert
  on public.project_handover_kits for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_handover_kits.project_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  );

create policy project_handover_receipts_studio_select
  on public.project_handover_receipts for select to authenticated
  using (
    exists (
      select 1
      from public.project_handover_kits k
      join public.projects p on p.id = k.project_id
      where k.id = project_handover_receipts.kit_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  );

revoke all on table public.project_handover_kits from public, anon, authenticated, service_role;
revoke all on table public.project_handover_receipts from public, anon, authenticated, service_role;
grant select, insert on table public.project_handover_kits to authenticated;
grant select on table public.project_handover_receipts to authenticated;
-- Страница участника и маршрут «Получил» работают по токену участника (service role).
grant select on table public.project_handover_kits to service_role;
grant select, insert on table public.project_handover_receipts to service_role;

-- Комплект: только из принятого КП этого проекта и в комнату этого проекта.
create or replace function public.guard_project_handover_kit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_proposal record;
begin
  if tg_op <> 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      raise exception using errcode = '42501', message = 'HANDOVER_KIT_IMMUTABLE';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select project_id, version, status into v_proposal
  from public.proposals where id = new.proposal_id;
  if not found or v_proposal.status <> 'accepted' then
    raise exception using errcode = '42501', message = 'HANDOVER_KIT_PROPOSAL_NOT_ACCEPTED';
  end if;
  if v_proposal.project_id is distinct from new.project_id
     or v_proposal.version is distinct from new.proposal_version
     or not exists (
       select 1 from public.project_rooms r
       where r.id = new.room_id and r.project_id = new.project_id
     ) then
    raise exception using errcode = '42501', message = 'HANDOVER_KIT_SUBJECT_MISMATCH';
  end if;
  return new;
end
$function$;

create trigger project_handover_kits_guard
  before insert or update or delete on public.project_handover_kits
  for each row execute function public.guard_project_handover_kit();

-- «Получил»: только исполнитель комнаты этого комплекта.
create or replace function public.guard_project_handover_receipt()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op <> 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      raise exception using errcode = '42501', message = 'HANDOVER_RECEIPT_APPEND_ONLY';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if not exists (
    select 1
    from public.project_handover_kits k
    join public.project_participants pp on pp.room_id = k.room_id
    where k.id = new.kit_id and pp.id = new.participant_id and pp.role = 'executor'
  ) then
    raise exception using errcode = '42501', message = 'HANDOVER_RECEIPT_NOT_EXECUTOR';
  end if;
  return new;
end
$function$;

create trigger project_handover_receipts_guard
  before insert or update or delete on public.project_handover_receipts
  for each row execute function public.guard_project_handover_receipt();

-- Журнал комнаты: передача комплекта и подтверждение получения.
alter table public.project_task_events drop constraint project_task_events_event_type_check;
alter table public.project_task_events add constraint project_task_events_event_type_check
  check (event_type in (
    'room_created',
    'task_created',
    'task_status_changed',
    'handover_kit_created',
    'handover_kit_received'
  ));

revoke all on function public.guard_project_handover_kit() from public, anon, authenticated;
revoke all on function public.guard_project_handover_receipt() from public, anon, authenticated;

commit;
