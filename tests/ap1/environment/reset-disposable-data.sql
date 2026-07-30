\set ON_ERROR_STOP on

-- Destructive by design, but invoked only after the shell runner has accepted
-- the exact isolated AP1 Docker socket and rejected any linked Supabase project.
do $ap1_reset_application_data$
declare
  v_tables text;
begin
  select string_agg(
    format('%I.%I', table_schema, table_name),
    ', ' order by table_schema, table_name
  ) into v_tables
  from information_schema.tables
  where table_type = 'BASE TABLE'
    and table_schema in (
      'public',
      'project_intelligence',
      'projectceo_foundation',
      'projectceo_product',
      'projectceo_m4'
    );

  if v_tables is null then
    raise exception 'AP1_DISPOSABLE_APPLICATION_TABLES_MISSING';
  end if;
  execute 'truncate table ' || v_tables || ' restart identity cascade';
end
$ap1_reset_application_data$;

truncate table auth.users cascade;
truncate table auth.audit_log_entries restart identity;
truncate table storage.objects restart identity cascade;

insert into project_intelligence.deployment_cells (cell_code)
values ('ru');

do $ap1_reset_invariants$
begin
  if (select count(*) from auth.users) <> 0
     or (select count(*) from public.projects) <> 0
     or (select count(*) from project_intelligence.project_workflows) <> 0
     or (select count(*) from projectceo_foundation.command_records) <> 0
     or (select count(*) from projectceo_product.command_records) <> 0
     or (select count(*) from projectceo_m4.change_requests) <> 0
     or (select count(*) from storage.objects) <> 0
     or (select count(*) from project_intelligence.deployment_cells) <> 1
     or not exists (
       select 1
       from storage.buckets bucket
       where bucket.id = 'client-uploads'
         and bucket.public = false
     )
  then
    raise exception 'AP1_DISPOSABLE_RESET_INVARIANT_FAILED';
  end if;
end
$ap1_reset_invariants$;

select 'AP1_DISPOSABLE_DATA_RESET_OK' as result;
