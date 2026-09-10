-- WP-26 S-MIG #5: request-bound reads for legacy client uploads.
-- Additive only. The private bucket remains private; authenticated studio
-- members can read objects only when the object is bound to their project.

begin;

do $wp26_storage_policy$
begin
  -- Supabase provides storage.objects. Local DB4 prelude omits that managed
  -- relation, so keep the migration replayable in the disposable harness.
  if to_regclass('storage.objects') is not null then
    execute $policy$
      drop policy if exists client_uploads_studio_select on storage.objects;
      create policy client_uploads_studio_select
        on storage.objects
        for select
        to authenticated
        using (
          bucket_id = 'client-uploads'
          and (
            (
              name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/'
              and public.is_studio_member(split_part(name, '/', 1)::uuid, auth.uid())
            )
            or exists (
              select 1
              from public.answers answer
              join public.projects project on project.id = answer.project_id
              where answer.question_id in ('attachments', 'designer_plan_attachments')
                and project.designer_id is not null
                and public.is_studio_member(project.designer_id, auth.uid())
                and answer.value @> jsonb_build_array(jsonb_build_object('path', storage.objects.name))
            )
          )
        )
    $policy$;
  end if;
end
$wp26_storage_policy$;

commit;
