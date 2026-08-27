\set ON_ERROR_STOP on

do $dbig_schema_security$
declare
  v_missing text;
  v_problem text;
  v_count bigint;
begin
  select expected.name into v_missing
  from (values
    ('remhaos_integration'),
    ('remhaos_integration_api')
  ) expected(name)
  where not exists (
    select 1 from pg_namespace n where n.nspname = expected.name
  )
  limit 1;
  if v_missing is not null then
    raise exception 'DBIG_MISSING_SCHEMA:%', v_missing;
  end if;

  select expected.name into v_missing
  from (values
    ('providers'),
    ('oauth_intents'),
    ('connections'),
    ('project_connections'),
    ('command_records'),
    ('audit_events'),
    ('external_objects'),
    ('import_candidates'),
    ('sync_jobs'),
    ('webhook_receipts'),
    ('project_links'),
    ('project_link_revisions'),
    ('file_intakes'),
    ('file_intake_events'),
    ('telegram_bindings'),
    ('telegram_updates'),
    ('telegram_attachments'),
    ('telegram_candidates'),
    ('telegram_ingestion_jobs'),
    ('google_drive_connector_config'),
    ('google_drive_webhook_channels'),
    ('google_drive_webhook_notifications')
  ) expected(name)
  where not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'remhaos_integration'
      and c.relname = expected.name
      and c.relkind in ('r', 'p')
  )
  limit 1;
  if v_missing is not null then
    raise exception 'DBIG_MISSING_TABLE:%', v_missing;
  end if;

  select n.nspname into v_problem
  from pg_namespace n
  where n.nspname = 'remhaos_integration'
    and (
      has_schema_privilege('anon', n.oid, 'USAGE')
      or has_schema_privilege('authenticated', n.oid, 'USAGE')
      or has_schema_privilege('service_role', n.oid, 'USAGE')
      or has_schema_privilege('pi_human_executor', n.oid, 'USAGE')
      or has_schema_privilege('pi_worker_executor', n.oid, 'USAGE')
      or exists (
        select 1
        from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
        where acl.grantee = 0
          and acl.privilege_type in ('USAGE', 'CREATE')
      )
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DBIG_PRIVATE_SCHEMA_EXPOSED:%', v_problem;
  end if;

  if not has_schema_privilege(
       'authenticated',
       'remhaos_integration_api',
       'USAGE'
     )
     or not has_schema_privilege(
       'service_role',
       'remhaos_integration_api',
       'USAGE'
     )
     or not has_schema_privilege(
       'pi_worker_executor',
       'remhaos_integration_api',
       'USAGE'
     )
     or has_schema_privilege('anon', 'remhaos_integration_api', 'USAGE')
     or has_schema_privilege(
       'pi_human_executor',
       'remhaos_integration_api',
       'USAGE'
     ) then
    raise exception 'DBIG_API_SCHEMA_ACL';
  end if;

  select format('%I.%I', n.nspname, c.relname)
  into v_problem
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'remhaos_integration'
    and c.relkind in ('r', 'p')
    and (
      pg_get_userbyid(c.relowner) <> 'pi_table_owner'
      or not c.relrowsecurity
      or not c.relforcerowsecurity
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DBIG_TABLE_SECURITY:%', v_problem;
  end if;

  select format('%I:%I', table_name, grantee)
  into v_problem
  from information_schema.role_table_grants
  where table_schema = 'remhaos_integration'
    and grantee in (
      'PUBLIC',
      'anon',
      'authenticated',
      'service_role',
      'pi_human_executor',
      'pi_worker_executor'
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DBIG_DIRECT_TABLE_GRANT:%', v_problem;
  end if;

  select p.oid::regprocedure::text into v_problem
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'remhaos_integration'
    and (
      exists (
        select 1
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
      or has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or has_function_privilege('service_role', p.oid, 'EXECUTE')
      or has_function_privilege('pi_human_executor', p.oid, 'EXECUTE')
      or has_function_privilege('pi_worker_executor', p.oid, 'EXECUTE')
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DBIG_PRIVATE_FUNCTION_EXPOSED:%', v_problem;
  end if;

  select p.oid::regprocedure::text into v_problem
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('remhaos_integration', 'remhaos_integration_api')
    and p.prosecdef
    and (
      pg_get_userbyid(p.proowner) <> 'pi_table_owner'
      or coalesce(array_to_string(p.proconfig, ','), '') !~
        '(^|,)search_path=""(,|$)'
      or exists (
        select 1
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DBIG_UNSAFE_DEFINER:%', v_problem;
  end if;

  select expected.signature into v_missing
  from (values
    ('remhaos_integration_api.list_available_integration_providers()'),
    ('remhaos_integration_api.list_organization_connections(uuid)'),
    ('remhaos_integration_api.disconnect_integration_connection(uuid,text,text)'),
    ('remhaos_integration_api.list_project_connections(uuid)'),
    ('remhaos_integration_api.bind_project_connection(uuid,uuid,text[],text)'),
    ('remhaos_integration_api.unbind_project_connection(uuid,text,text)'),
    ('remhaos_integration_api.list_project_links(uuid)'),
    ('remhaos_integration_api.get_project_link_access(uuid)'),
    ('remhaos_integration_api.create_project_link(uuid,text,text,text,text[],text,text)'),
    ('remhaos_integration_api.revise_project_link(uuid,uuid,text,text[],text,text,text)'),
    ('remhaos_integration_api.archive_project_link(uuid,uuid,text,text)'),
    ('remhaos_integration_api.publish_project_link_to_client(uuid,uuid,integer,text)'),
    ('remhaos_integration_api.create_file_intake(uuid,text,text,text,bigint,text,text,text)'),
    ('remhaos_integration_api.create_file_intake_worker(uuid,text,text,text,bigint,text,text,text)'),
    ('remhaos_integration_api.mark_file_intake_uploaded(uuid,uuid,text)'),
    ('remhaos_integration_api.mark_file_intake_uploaded_worker(uuid,uuid,text)'),
    ('remhaos_integration_api.complete_file_intake_scan(uuid,uuid,text,text)'),
    ('remhaos_integration_api.review_file_intake(uuid,uuid,text,text,text)'),
    ('remhaos_integration_api.publish_file_intake(uuid,uuid,text)'),
    ('remhaos_integration_api.list_file_intakes(uuid)'),
    ('remhaos_integration_api.get_file_intake_storage(uuid,uuid)'),
    ('remhaos_integration_api.authorize_file_intake_download(uuid,uuid,integer)'),
    ('remhaos_integration_api.bind_telegram_chat(uuid,bigint,text,text)'),
    ('remhaos_integration_api.migrate_telegram_chat(uuid,uuid,bigint,text,text)'),
    ('remhaos_integration_api.list_telegram_bindings(uuid)'),
    ('remhaos_integration_api.ingest_telegram_update(uuid,bigint,bigint,bigint,bigint,text,text,jsonb,text)'),
    ('remhaos_integration_api.claim_telegram_ingestion_jobs(integer,integer)'),
    ('remhaos_integration_api.complete_telegram_ingestion_job(uuid,uuid,jsonb,text)'),
    ('remhaos_integration_api.fail_telegram_ingestion_job(uuid,uuid,text,boolean,integer,integer,text)'),
    ('remhaos_integration_api.list_telegram_candidates(uuid)'),
    ('remhaos_integration_api.review_telegram_candidate(uuid,uuid,text,text,text)'),
    ('remhaos_integration_api.create_oauth_intent(uuid,text,bytea,text,bytea,text[],timestamptz,text)'),
    ('remhaos_integration_api.list_import_candidates(uuid,text)'),
    ('remhaos_integration_api.review_import_candidate(uuid,text,jsonb,text)'),
    ('remhaos_integration_api.consume_oauth_intent(text,bytea,bytea)'),
    ('remhaos_integration_api.activate_oauth_connection(uuid,text,text[],bytea,text,jsonb,timestamptz,text)'),
    ('remhaos_integration_api.record_verified_webhook(text,bytea,bytea,text,text,timestamptz,text)'),
    ('remhaos_integration_api.enqueue_integration_job(uuid,uuid,uuid,text,text,jsonb)'),
    ('remhaos_integration_api.claim_integration_jobs(integer,integer)'),
    ('remhaos_integration_api.complete_integration_job(uuid,uuid,jsonb,text)'),
    ('remhaos_integration_api.fail_integration_job(uuid,uuid,text,boolean,integer,integer,text)'),
    ('remhaos_integration_api.upsert_external_object(uuid,text,bytea,text,text,text,bigint,text,timestamptz,jsonb,text)'),
    ('remhaos_integration_api.create_import_candidate(uuid,uuid,text,text,text,text,text,jsonb,text)')
    ,('remhaos_integration_api.create_google_drive_webhook_channel(uuid,uuid,bytea,bytea,timestamptz,text)')
    ,('remhaos_integration_api.stop_google_drive_webhook_channel(uuid,uuid,uuid,text,text)')
    ,('remhaos_integration_api.expire_google_drive_webhook_channels()')
    ,('remhaos_integration_api.resolve_google_drive_webhook_channel(bytea,bytea)')
    ,('remhaos_integration_api.record_google_drive_notification(uuid,uuid,uuid,bytea,bytea,bytea,bytea,text)')
    ,('remhaos_integration_api.mark_google_drive_reauth_required(uuid,uuid,text,text)')
    ,('remhaos_integration_api.list_team_project_connections(uuid)')
    ,('remhaos_integration_api.request_manual_integration_sync(uuid,uuid,text)')
    ,('remhaos_integration_api.resolve_telegram_webhook_binding(bigint)')
    ,('remhaos_integration_api.get_integration_credential_ref(uuid)')
    ,('remhaos_integration_api.claim_selected_google_drive_import_jobs(integer,integer)')
    ,('remhaos_integration_api.request_selected_google_drive_import(uuid,uuid,text,text,text)')
  ) expected(signature)
  where to_regprocedure(expected.signature) is null
  limit 1;
  if v_missing is not null then
    raise exception 'DBIG_MISSING_RPC:%', v_missing;
  end if;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'remhaos_integration_api'
    and p.prokind = 'f';
  if v_count <> 55 then
    raise exception 'DBIG_UNEXPECTED_RPC_COUNT:%', v_count;
  end if;

  select p.oid::regprocedure::text into v_problem
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'remhaos_integration_api'
    and (
      exists (
        select 1
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
      or has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        is distinct from (
          p.proname = any (array[
            'list_available_integration_providers',
            'list_organization_connections',
            'list_team_project_connections',
            'request_manual_integration_sync',
            'disconnect_integration_connection',
            'list_project_connections',
            'bind_project_connection',
            'unbind_project_connection',
            'list_project_links',
            'get_project_link_access',
            'create_project_link',
            'revise_project_link',
            'archive_project_link',
            'publish_project_link_to_client',
            'create_file_intake',
            'mark_file_intake_uploaded',
            'review_file_intake',
            'publish_file_intake',
            'list_file_intakes',
            'get_file_intake_storage',
            'authorize_file_intake_download',
            'list_import_candidates',
            'review_import_candidate',
            'bind_telegram_chat',
            'migrate_telegram_chat',
            'list_telegram_bindings',
            'list_telegram_candidates',
            'review_telegram_candidate'
            , 'create_oauth_intent'
            , 'request_selected_google_drive_import'
          ]::text[])
        )
      or has_function_privilege('service_role', p.oid, 'EXECUTE')
        is distinct from (
          p.proname = any (array[
            'consume_oauth_intent',
            'activate_oauth_connection',
            'record_verified_webhook',
            'enqueue_integration_job',
            'claim_integration_jobs',
            'complete_integration_job',
            'fail_integration_job',
            'upsert_external_object',
            'create_import_candidate',
            'mark_google_drive_reauth_required',
            'resolve_telegram_webhook_binding',
            'get_integration_credential_ref',
            'claim_selected_google_drive_import_jobs'
          ]::text[])
        )
      or has_function_privilege('pi_worker_executor', p.oid, 'EXECUTE')
        is distinct from (
          p.proname = any (array[
            'consume_oauth_intent',
            'activate_oauth_connection',
            'record_verified_webhook',
            'enqueue_integration_job',
            'claim_integration_jobs',
            'complete_integration_job',
            'fail_integration_job',
            'upsert_external_object',
            'create_import_candidate',
            'create_file_intake_worker',
            'mark_file_intake_uploaded_worker',
            'complete_file_intake_scan',
            'ingest_telegram_update',
            'claim_telegram_ingestion_jobs',
            'complete_telegram_ingestion_job',
            'fail_telegram_ingestion_job',
            'create_google_drive_webhook_channel',
            'stop_google_drive_webhook_channel',
            'expire_google_drive_webhook_channels',
            'resolve_google_drive_webhook_channel',
            'record_google_drive_notification',
            'mark_google_drive_reauth_required',
            'resolve_telegram_webhook_binding',
            'get_integration_credential_ref',
            'claim_selected_google_drive_import_jobs'
          ]::text[])
        )
      or has_function_privilege('pi_human_executor', p.oid, 'EXECUTE')
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DBIG_RPC_ACL_MISMATCH:%', v_problem;
  end if;

  select format('%I.%I:%I', n.nspname, t.relname, c.conname)
  into v_problem
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'remhaos_integration'
    and c.contype = 'f'
    and not exists (
      select 1
      from pg_index i
      where i.indrelid = c.conrelid
        and i.indisvalid
        and i.indisready
        and i.indnkeyatts >= cardinality(c.conkey)
        and not exists (
          select 1
          from generate_subscripts(c.conkey, 1) key_position
          where i.indkey[key_position - 1] <> c.conkey[key_position]
        )
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DBIG_UNINDEXED_FOREIGN_KEY:%', v_problem;
  end if;
end
$dbig_schema_security$;

select 'DBIG_SCHEMA_SECURITY_OK' as result;
