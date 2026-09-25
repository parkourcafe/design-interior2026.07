-- Covers the composite package foreign key on append-only client review comments.
begin;
create index m2_client_review_comments_package_idx
  on projectceo_product.m2_client_review_comments (organization_id, project_id, package_id);
commit;
