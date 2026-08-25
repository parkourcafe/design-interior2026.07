\set ON_ERROR_STOP on

-- DB4: persistence каталога воркфлоу (Фаза 2, A5). Seed = 5 шаблонов
-- каталога v1; форма шагов под триггером; чтение — членам проекта.

begin;
do $assert_seed$
declare
  v_count integer;
  v_m1_steps integer;
  v_tg_steps integer;
  v_m4_status text;
begin
  set local role pi_table_owner;
  select count(*) into v_count from projectceo_platform.workflow_templates;
  if v_count <> 5 then
    raise exception 'DB4_WORKFLOW_TEMPLATES_COUNT:%', v_count;
  end if;
  select jsonb_array_length(steps) into v_m1_steps
  from projectceo_platform.workflow_templates where template_id = 'WF-M1-001';
  select jsonb_array_length(steps) into v_tg_steps
  from projectceo_platform.workflow_templates where template_id = 'WF-TG-001';
  if v_m1_steps <> 8 or v_tg_steps <> 8 then
    raise exception 'DB4_WORKFLOW_STEPS_COUNT:%/%', v_m1_steps, v_tg_steps;
  end if;
  select auth_status into v_m4_status
  from projectceo_platform.workflow_templates where template_id = 'WF-M4-001';
  if v_m4_status <> 'partially_authorized' then
    raise exception 'DB4_WORKFLOW_M4_STATUS:%', v_m4_status;
  end if;
end
$assert_seed$;
commit;

-- === Форма шагов под триггером ==============================================

begin;
do $bad_step_denied$
begin
  set local role pi_table_owner;
  insert into projectceo_platform.workflow_templates (
    template_id, owner_module, auth_status, basis, summary, steps
  ) values (
    'WF-X9-999', 'platform', 'authorized', 'probe', 'проба без action',
    '[{"costClass": "free_deterministic"}]'::jsonb
  );
  raise exception 'DB4_WORKFLOW_BAD_STEP_ACCEPTED';
exception
  when object_not_in_prerequisite_state then null;
  when insufficient_privilege then null;
end
$bad_step_denied$;
rollback;

-- === Чтение: член проекта видит каталог, anon — нет =========================

begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $member_read$
declare
  v_data jsonb;
begin
  v_data := projectceo_platform_api.list_workflow_templates();
  if jsonb_array_length(v_data -> 'templates') <> 5 then
    raise exception 'DB4_WORKFLOW_READ_COUNT_INVALID';
  end if;
end
$member_read$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666666';
do $nonmember_denied$
begin
  perform projectceo_platform_api.list_workflow_templates();
  raise exception 'DB4_WORKFLOW_NONMEMBER_READ_ACCEPTED';
exception when sqlstate 'P1103' then null;
end
$nonmember_denied$;
rollback;

begin;
set local role anon;
do $anon_denied$
begin
  perform projectceo_platform_api.list_workflow_templates();
  raise exception 'DB4_WORKFLOW_ANON_READ_ACCEPTED';
exception when insufficient_privilege then null;
end
$anon_denied$;
rollback;

select 'DB4_WORKFLOW_TEMPLATES_OK' as result;
