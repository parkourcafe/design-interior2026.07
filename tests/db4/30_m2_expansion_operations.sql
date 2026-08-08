-- DB4 additive M2 expansion rehearsal. Run after 20_product_operations.sql.
-- This is a disposable-clone test only; it never targets production.

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.append_m2_workspace_revision(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'room', 'db4-room', 'db4-room-r1', null, 'draft',
  '{"name":"Кухня-гостиная","areaM2":42}', 'DB4 M2 room', 29, 'db4-m2-room'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.append_m2_workspace_revision(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'variant', 'db4-variant', 'db4-variant-r1', null, 'draft',
  '{"roomId":"db4-room","title":"Тёплый вариант","description":"Пилот"}', 'DB4 M2 variant', 30, 'db4-m2-variant'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.append_m2_workspace_revision(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'material', 'db4-material', 'db4-material-r1', null, 'draft',
  '{"variantId":"db4-variant","name":"Керамогранит","supplierRef":"SKU-DB4","unit":"м²","unitCostRub":4500,"quantity":42}', 'DB4 M2 material', 31, 'db4-m2-material'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.append_m2_workspace_revision(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'budget', 'db4-budget', 'db4-budget-r1', null, 'draft',
  '{"currency":"RUB","minRub":180000,"maxRub":260000,"contingencyPct":10}', 'DB4 M2 budget', 32, 'db4-m2-budget'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.append_m2_workspace_revision(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'client_handoff', 'db4-handoff', 'db4-handoff-r1', null, 'submitted',
  '{"approvalPackageId":"approval-db4-root","title":"Передача клиенту","note":"Пакет approval подтверждён"}', 'DB4 M2 handoff', 33, 'db4-m2-handoff'
);
commit;

set role authenticated;
set request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $projection_assertions$
declare
  v_read jsonb;
begin
  select projectceo_read_api.get_project_workspace_read_v3(
    '41111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111111'
  ) into v_read;
  if jsonb_array_length(v_read->'data'->'m2Rooms') <> 1
     or jsonb_array_length(v_read->'data'->'m2Variants') <> 1
     or jsonb_array_length(v_read->'data'->'m2Materials') <> 1
     or jsonb_array_length(v_read->'data'->'m2BudgetFrames') <> 1
     or jsonb_array_length(v_read->'data'->'m2ClientHandoffs') <> 1 then
    raise exception 'DB4_M2_EXPANSION_READ_PROJECTION';
  end if;
end
$projection_assertions$;

reset role;
do $audit_assertions$
declare
begin
  if not exists (
    select 1 from projectceo_product.command_records
    where project_id = '41111111-1111-4111-8111-111111111111'
      and operation in (
        'append_m2_room_revision', 'append_m2_variant_revision',
        'append_m2_material_revision', 'append_m2_budget_revision',
        'append_m2_client_handoff_revision'
      )
    group by project_id having count(*) = 5
  ) then raise exception 'DB4_M2_EXPANSION_AUDIT'; end if;
end
$audit_assertions$;

select 'DB4_M2_EXPANSION_OK' as result;
