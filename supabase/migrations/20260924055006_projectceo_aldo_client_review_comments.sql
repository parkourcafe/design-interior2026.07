-- AW-02 discussion is append-only and deliberately independent of approval.
begin;
create table projectceo_product.m2_client_review_comments (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  submission_id text not null check (char_length(btrim(submission_id)) between 1 and 160),
  submission_revision_id text not null check (char_length(btrim(submission_revision_id)) between 1 and 160),
  comment_id uuid not null default extensions.gen_random_uuid(),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  idempotency_digest bytea not null check (octet_length(idempotency_digest)=32),
  author_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, project_id, comment_id),
  unique (organization_id,project_id,idempotency_digest),
  foreign key (organization_id, project_id) references project_intelligence.project_workflows(organization_id, project_id) on delete restrict,
  foreign key (organization_id, project_id, package_id) references projectceo_foundation.project_packages(organization_id, project_id, id) on delete restrict,
  foreign key (organization_id, author_user_id) references project_intelligence.organization_members(organization_id, user_id) on delete restrict
);
alter table projectceo_product.m2_client_review_comments enable row level security;
alter table projectceo_product.m2_client_review_comments force row level security;
alter table projectceo_product.m2_client_review_comments owner to pi_table_owner;
revoke all on table projectceo_product.m2_client_review_comments from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
create policy m2_client_review_comments_internal_owner on projectceo_product.m2_client_review_comments for all to pi_table_owner using(true) with check(true);
create function projectceo_product.reject_m2_client_review_comment_mutation() returns trigger language plpgsql set search_path='' as $function$ begin raise exception using errcode='55000',message='M2_CLIENT_REVIEW_COMMENT_APPEND_ONLY'; end $function$;
create trigger m2_client_review_comments_append_only before update or delete on projectceo_product.m2_client_review_comments for each row execute function projectceo_product.reject_m2_client_review_comment_mutation();
create function projectceo_product_api.list_m2_client_review_comments(project_id uuid, package_id uuid, submission_id text, submission_revision_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare ctx record; data jsonb;
begin
 select * into strict ctx from projectceo_foundation._authorize_package_human(project_id,package_id,'view_project');
 select coalesce(jsonb_agg(jsonb_build_object('commentId',comment_id,'submissionRevisionId',submission_revision_id,'body',body,'authorUserId',author_user_id,'createdAt',created_at) order by created_at,comment_id),'[]'::jsonb) into data
 from projectceo_product.m2_client_review_comments row where row.organization_id=ctx.organization_id and row.project_id=list_m2_client_review_comments.project_id and row.package_id=list_m2_client_review_comments.package_id and row.submission_id=list_m2_client_review_comments.submission_id and row.submission_revision_id=list_m2_client_review_comments.submission_revision_id;
 return jsonb_build_object('comments',data);
end $function$;
alter function projectceo_product_api.list_m2_client_review_comments(uuid,uuid,text,text) owner to pi_table_owner;
create function projectceo_product_api.add_m2_client_review_comment(project_id uuid,package_id uuid,submission_id text,submission_revision_id text,body text,idempotency_key text)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare ctx record; review_row record; comment_row projectceo_product.m2_client_review_comments%rowtype; key_digest bytea;
begin
 perform projectceo_foundation._assert_idempotency_key(idempotency_key);
 key_digest:=project_intelligence._sha256_text(btrim(idempotency_key));
 select * into strict ctx from projectceo_foundation._authorize_package_human(project_id,package_id,'view_project');
 select * into strict review_row from projectceo_product.m2_workspace_revisions r where r.organization_id=ctx.organization_id and r.project_id=project_id and r.package_id=package_id and r.entity_kind='m2_client_submission' and r.entity_id=submission_id and r.revision_id=submission_revision_id and r.status='submitted';
 if (review_row.payload->>'assignedClientUserId')::uuid is distinct from ctx.actor_user_id then perform projectceo_product._raise('P1103','forbidden','{"reason":"COMMENTER_IDENTITY_INVALID"}'::jsonb); end if;
 select * into comment_row from projectceo_product.m2_client_review_comments c where c.organization_id=ctx.organization_id and c.project_id=project_id and c.idempotency_digest=key_digest;
 if found then
  if comment_row.package_id<>package_id or comment_row.submission_id<>submission_id or comment_row.submission_revision_id<>submission_revision_id or comment_row.body<>body then perform projectceo_product._raise('P1108','idempotency_conflict','{}'::jsonb); end if;
  return jsonb_build_object('operation','add_m2_client_review_comment','replay',true,'result',jsonb_build_object('commentId',comment_row.comment_id,'submissionRevisionId',submission_revision_id));
 end if;
 insert into projectceo_product.m2_client_review_comments(organization_id,project_id,package_id,submission_id,submission_revision_id,body,idempotency_digest,author_user_id) values(ctx.organization_id,project_id,package_id,submission_id,submission_revision_id,body,key_digest,ctx.actor_user_id) returning * into comment_row;
 return jsonb_build_object('operation','add_m2_client_review_comment','replay',false,'result',jsonb_build_object('commentId',comment_row.comment_id,'submissionRevisionId',submission_revision_id));
end $function$;
alter function projectceo_product_api.add_m2_client_review_comment(uuid,uuid,text,text,text,text) owner to pi_table_owner;
revoke all on function projectceo_product_api.add_m2_client_review_comment(uuid,uuid,text,text,text,text) from public,anon,service_role,pi_human_executor,pi_worker_executor;
revoke all on function projectceo_product_api.list_m2_client_review_comments(uuid,uuid,text,text) from public,anon,service_role,pi_human_executor,pi_worker_executor;
grant execute on function projectceo_product_api.list_m2_client_review_comments(uuid,uuid,text,text) to authenticated;
grant execute on function projectceo_product_api.add_m2_client_review_comment(uuid,uuid,text,text,text,text) to authenticated;
commit;
