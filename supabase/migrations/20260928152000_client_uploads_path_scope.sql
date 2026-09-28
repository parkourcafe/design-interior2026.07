-- Аудит 28.09: межпроектная выдача файлов через ответ брифа.
--
-- Политика client_uploads_studio_select (20260910100000) открывала участнику
-- студии файл, если его путь записан в ответах `attachments` /
-- `designer_plan_attachments` проекта этой студии. Путь в ответах мог записать
-- кто угодно, у кого есть ссылка на бриф (отправка брифа принимала любые
-- ключи), — в том числе путь к файлу чужого проекта. Маршрут отправки больше не
-- принимает эти ключи; здесь — защита в глубину: путь из ответа засчитывается,
-- только если лежит в папке этого же проекта.
--   * файлы клиента: `{project_id}/...`
--   * планы дизайнера: `designer-plans/{project_id}/...`

begin;

do $client_uploads_scope$
begin
  -- storage.objects есть в Supabase; в харнессе DB4 его нет.
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
                and (
                  starts_with(storage.objects.name, project.id::text || '/')
                  or starts_with(storage.objects.name, 'designer-plans/' || project.id::text || '/')
                )
            )
          )
        )
    $policy$;
  end if;
end
$client_uploads_scope$;

commit;
