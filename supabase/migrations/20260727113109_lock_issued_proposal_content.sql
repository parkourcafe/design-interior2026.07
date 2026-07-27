-- Issued proposal rows are the legacy projection of an immutable approved
-- proposal revision. They remain readable through existing public links, but
-- their governed content and identity cannot be changed in place.

create or replace function private.enforce_issued_proposal_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'sent'
    and (
      new.project_id is distinct from old.project_id
      or new.version is distinct from old.version
      or new.sections is distinct from old.sections
      or new.status is distinct from old.status
      or new.public_token is distinct from old.public_token
      or new.sent_at is distinct from old.sent_at
      or new.issued_revision_id is distinct from old.issued_revision_id
      or new.created_at is distinct from old.created_at
    ) then
    raise exception 'issued proposal content is immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_issued_proposal_immutability()
  from public, anon, authenticated;

drop trigger if exists proposals_issued_immutable on public.proposals;
create trigger proposals_issued_immutable
before update on public.proposals
for each row execute function private.enforce_issued_proposal_immutability();
