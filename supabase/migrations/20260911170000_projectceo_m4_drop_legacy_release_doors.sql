-- S-MIG #4: request-bound M4 release doors replace retired legacy tombstones.
begin;

create or replace function projectceo_platform._module_signatures(p_module text)
returns text[] language sql immutable security definer set search_path = '' as $function$
  select case p_module
    when 'm3' then array[
      'projectceo_product_api.publish_baseline_atomic(uuid, text, text, bigint, text, text)',
      'projectceo_product_api.publish_release_request_bound(uuid, text, text, bigint, text, text)',
      'projectceo_product_api.publish_work_package_release_request_bound(uuid, uuid, text, text, bigint, text, text)',
      'projectceo_api.review_source(uuid, text, text, bigint, text, text)',
      'projectceo_m3_api.register_documentation_sheet(uuid, uuid, text, text, text, text, text, text, text[], text, bigint, text)',
      'projectceo_m3_api.attach_documentation_sheet_specifications(uuid, uuid, text, text, text, text[], text, bigint, text)'
    ]
    when 'm4_increment_1' then array[
      'projectceo_product_api.distribute_release_request_bound(uuid, text, uuid, bigint, text)',
      'projectceo_product_api.acknowledge_release_request_bound(uuid, uuid, text, bigint, text)',
      'projectceo_m4_api.submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, bigint, text)',
      'projectceo_m4_api.replay_submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, text)'
    ] else null end;
$function$;
alter function projectceo_platform._module_signatures(text) owner to pi_table_owner;

drop function projectceo_product_api.distribute_release(uuid, text, uuid, bigint, text);
drop function projectceo_product_api.acknowledge_release(uuid, uuid, text, bigint, text);
commit;
