-- RemHaOS Integration Gateway PR4: bind Telegram quarantine objects to the
-- authenticated organization/project and content-addressed source role.
--
-- Additive guard. The historical Telegram migration remains immutable; this
-- trigger closes the direct-RPC path as well as the application worker path.

begin;

create function remhaos_integration.telegram_attachment_quarantine_key_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_expected_key text;
begin
  v_expected_key :=
    'project-intelligence/ru/' || new.organization_id::text || '/' ||
    new.project_id::text || '/quarantine/telegram/' ||
    encode(new.checksum, 'hex') || '/' || new.source_role;
  if new.quarantine_object_key is distinct from v_expected_key then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"quarantineObjectKey","reason":"CANONICAL_KEY_REQUIRED"}'::jsonb
    );
  end if;
  return new;
end
$function$;

create trigger telegram_attachment_quarantine_key_guard
  before insert or update of organization_id, project_id, checksum,
    quarantine_object_key, source_role
  on remhaos_integration.telegram_attachments
  for each row
  execute function remhaos_integration.telegram_attachment_quarantine_key_guard();

alter function remhaos_integration.telegram_attachment_quarantine_key_guard()
  owner to pi_table_owner;

revoke all on function remhaos_integration.telegram_attachment_quarantine_key_guard()
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;

commit;
