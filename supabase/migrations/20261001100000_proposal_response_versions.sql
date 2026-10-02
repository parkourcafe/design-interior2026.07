-- Ответ клиента на КП привязан к версии (E2E-20261001-1531, разрыв D1).
--
-- Раньше ответ фиксировался только событием проекта (events): без версии КП и
-- без текста замечания, а первый ответ закрывал решение для всего проекта. После
-- «Запросить правки» дизайнер не мог выпустить новую версию, а клиент — принять.
--
-- Теперь:
--   * один ответ на одну версию КП (уникальность proposal_id) — повтор той же
--     кнопки идемпотентен, другой ответ на ту же версию отклоняется маршрутом;
--   * замечание клиента (необязательно, до 2000 символов) хранится с ответом;
--   * запись — только серверным маршрутом по public_token (service role);
--     дизайнер студии читает ответы своих проектов; правка и удаление
--     конечными пользователями запрещены (журнал решений не переписывается).
-- События events по-прежнему пишутся для метрик.

begin;

create table public.proposal_responses (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  proposal_version integer not null check (proposal_version > 0),
  action text not null check (action in ('accept', 'discuss', 'changes')),
  comment text check (comment is null or char_length(comment) between 1 and 2000),
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  constraint proposal_responses_one_per_version unique (proposal_id),
  constraint proposal_responses_comment_not_on_accept check (action <> 'accept' or comment is null)
);

create index proposal_responses_project_idx on public.proposal_responses (project_id, created_at);

alter table public.proposal_responses enable row level security;
alter table public.proposal_responses force row level security;

create policy proposal_responses_studio_select
  on public.proposal_responses
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects p
      where p.id = proposal_responses.project_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  );

revoke all on table public.proposal_responses from public, anon, authenticated, service_role;
grant select on table public.proposal_responses to authenticated;
-- Маршрут ответа клиента (service role) только читает и добавляет.
grant select, insert on table public.proposal_responses to service_role;

-- Версия и проект ответа берутся из самого КП, а не из запроса.
create or replace function public.guard_proposal_response()
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
      raise exception using errcode = '42501', message = 'PROPOSAL_RESPONSE_APPEND_ONLY';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select id, project_id, version, status into v_proposal
  from public.proposals
  where id = new.proposal_id;
  if not found or v_proposal.status not in ('sent', 'accepted') then
    raise exception using errcode = '42501', message = 'PROPOSAL_RESPONSE_NOT_ISSUED';
  end if;
  if new.project_id is distinct from v_proposal.project_id
     or new.proposal_version is distinct from v_proposal.version then
    raise exception using errcode = '42501', message = 'PROPOSAL_RESPONSE_SUBJECT_MISMATCH';
  end if;
  return new;
end
$function$;

create trigger proposal_responses_guard
  before insert or update or delete on public.proposal_responses
  for each row execute function public.guard_proposal_response();

revoke all on function public.guard_proposal_response() from public, anon, authenticated;

commit;
