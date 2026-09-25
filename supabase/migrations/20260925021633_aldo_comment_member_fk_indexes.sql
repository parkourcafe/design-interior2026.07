-- Cover every organization-member foreign key on Aldo stage/comment records.
begin;
create index m2_client_review_comments_author_idx
  on projectceo_product.m2_client_review_comments (organization_id, author_user_id);
create index project_stage_revisions_owner_idx
  on projectceo_platform.project_stage_revisions (organization_id, owner_user_id);
create index project_stage_revisions_creator_idx
  on projectceo_platform.project_stage_revisions (organization_id, created_by);
create index project_stage_revisions_not_applicable_by_idx
  on projectceo_platform.project_stage_revisions (organization_id, not_applicable_by)
  where not_applicable_by is not null;
commit;
