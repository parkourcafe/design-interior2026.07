-- DEC-034/037: reviewing all returned cards is not complete impact coverage.
-- Reproduced on disposable PG16 through the public child-release RPC: a depth8
-- graph returned14 reviewed cards at maxDepth7 / partial_depth and still allowed
-- publication. The test rolls back all probe data. Harden the SHARED insert
-- trigger so root/child release doors cannot disagree about this invariant.
-- No existing hashes, successful command replays, roles or grants are changed.
begin;
do $require_complete_impact$
declare definition text;
  anchor text := 'and run.target_baseline_id = request.proposed_baseline_id';
begin
  definition := pg_get_functiondef('projectceo_m4.validate_product_release_impact_review()'::regprocedure);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 then
    raise exception 'RELEASE_IMPACT_COVERAGE_ANCHOR_MISMATCH';
  end if;
  execute replace(definition,anchor,anchor || '
     and run.coverage_status = ''complete''
     and run.superseded_at is null
     and not run.has_more_beyond_depth
     and run.cutoff_reason is null
     and run.known_impact_count_lower_bound = run.returned_impact_count');
end
$require_complete_impact$;
commit;
