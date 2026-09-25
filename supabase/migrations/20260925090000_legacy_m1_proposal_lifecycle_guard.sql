-- DEC-040 (решения владельца 25.09.2026) / финальный аудит 25.09.2026,
-- BUG-03 и BUG-04: жизненный цикл КП закрепляется в базе, а не только в
-- server action.
--
-- До этой миграции политика proposals_studio_all ("for all") позволяла любому
-- члену студии напрямую через PostgREST:
--   * поставить status='sent' без утверждённого approval паспорта (DEC-010);
--   * править sections уже отправленного или принятого КП, которое клиент
--     видит по живой ссылке /p/;
--   * откатить accepted → sent.
--
-- Граница (для запросов конечных пользователей, current_user in
-- authenticated/anon):
--   * вставка — только черновиком;
--   * draft → sent — только при утверждённом approval request с
--     subject_kind='project_passport' и subject_id = id проекта, прочитанном
--     тем же request-bound RPC, которым пользуется приложение;
--   * sent → accepted — только серверный путь ответа клиента (service role);
--   * любые другие переходы статуса отклоняются для всех ролей;
--   * содержимое не-черновика (sections, version, public_token, project_id,
--     sent_at) неизменяемо для всех ролей;
--   * удаление не-черновика конечным пользователем запрещено.
--
-- Функция SECURITY INVOKER намеренно: проверка approval исполняется от имени
-- того же пользователя и с той же авторизацией, что и в приложении.

begin;

create or replace function public.guard_proposal_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_end_user boolean := current_user in ('authenticated', 'anon');
  v_requests jsonb;
begin
  if tg_op = 'INSERT' then
    if v_end_user and new.status <> 'draft' then
      raise exception using
        errcode = '42501',
        message = 'PROPOSAL_INSERT_MUST_BE_DRAFT';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_end_user and old.status <> 'draft' then
      raise exception using
        errcode = '42501',
        message = 'PROPOSAL_ISSUED_DELETE_DENIED';
    end if;
    return old;
  end if;

  if old.status <> 'draft' and (
    new.sections is distinct from old.sections
    or new.version is distinct from old.version
    or new.public_token is distinct from old.public_token
    or new.project_id is distinct from old.project_id
    or new.sent_at is distinct from old.sent_at
  ) then
    raise exception using
      errcode = '42501',
      message = 'PROPOSAL_CONTENT_LOCKED';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'sent' then
      if v_end_user then
        begin
          v_requests := projectceo_platform_api.list_approval_requests(
            new.project_id, 'approved'
          ) -> 'requests';
        exception
          -- Незачисленный проект, нет view_project или нет доступа к схеме —
          -- approval не доказан. Прочие ошибки (сбой, deadlock, сериализация)
          -- пробрасываются как есть, а не маскируются под «нужен approval».
          when sqlstate 'P1101' or sqlstate 'P1103' or sqlstate 'P1104'
            or sqlstate 'P1109' or sqlstate 'P1111' or sqlstate '42501' then
            v_requests := null;
        end;
        if v_requests is null
          or jsonb_typeof(v_requests) <> 'array'
          or not exists (
            select 1
            from pg_catalog.jsonb_array_elements(v_requests) request
            where request ->> 'subjectKind' = 'project_passport'
              and request ->> 'subjectId' = new.project_id::text
              and request ->> 'status' = 'approved'
          ) then
          raise exception using
            errcode = '42501',
            message = 'PROPOSAL_APPROVAL_REQUIRED';
        end if;
      end if;
      new.sent_at := coalesce(new.sent_at, pg_catalog.statement_timestamp());
    elsif old.status = 'sent' and new.status = 'accepted' and not v_end_user then
      null;
    else
      raise exception using
        errcode = '42501',
        message = 'PROPOSAL_STATUS_TRANSITION_DENIED',
        detail = pg_catalog.format('%s -> %s', old.status, new.status);
    end if;
  end if;

  return new;
end
$function$;

revoke all on function public.guard_proposal_lifecycle()
  from public, anon, authenticated, service_role;

drop trigger if exists proposals_lifecycle_guard on public.proposals;
create trigger proposals_lifecycle_guard
  before insert or update or delete on public.proposals
  for each row execute function public.guard_proposal_lifecycle();

commit;
