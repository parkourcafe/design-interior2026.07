-- Срок действия и отзыв клиентской ссылки на КП /p/<public_token>
-- (оценка ПДн 01.10.2026: «ссылка должна иметь ограниченный срок действия и
-- возможность отзыва»). Раньше выданная ссылка открывалась бессрочно.
--
--   * при отправке КП ссылка действует 90 дней (столько же, сколько анкета по
--     проекту согласия клиента);
--   * дизайнер может продлить её не дальше чем на 90 дней от текущего момента
--     или отозвать (срок = сейчас); убрать срок совсем нельзя;
--   * уже отправленным КП срок проставляется от даты отправки.
-- Проверку срока делают страница КП и маршрут ответа клиента.

begin;

alter table public.proposals add column public_expires_at timestamptz;

create or replace function public.set_proposal_public_expiry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_end_user boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' and new.public_expires_at is null then
      new.public_expires_at := coalesce(new.sent_at, pg_catalog.statement_timestamp()) + interval '90 days';
    end if;
    return new;
  end if;

  -- Отправка: срок ставится сервером, а не клиентом.
  if old.status = 'draft' and new.status <> 'draft' then
    new.public_expires_at := pg_catalog.statement_timestamp() + interval '90 days';
    return new;
  end if;

  if v_end_user and new.public_expires_at is distinct from old.public_expires_at then
    if new.status = 'draft' then
      new.public_expires_at := old.public_expires_at;
    elsif new.public_expires_at is null
       or new.public_expires_at > pg_catalog.statement_timestamp() + interval '90 days 1 minute' then
      raise exception using
        errcode = '42501',
        message = 'PROPOSAL_PUBLIC_EXPIRY_OUT_OF_RANGE';
    end if;
  end if;
  return new;
end
$function$;

create trigger proposals_public_expiry
  before insert or update on public.proposals
  for each row execute function public.set_proposal_public_expiry();

revoke all on function public.set_proposal_public_expiry() from public, anon, authenticated;

update public.proposals
set public_expires_at = coalesce(sent_at, pg_catalog.statement_timestamp()) + interval '90 days'
where status <> 'draft' and public_expires_at is null;

commit;
