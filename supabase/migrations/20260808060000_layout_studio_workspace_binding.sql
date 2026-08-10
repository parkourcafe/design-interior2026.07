-- Layout Studio (модуль 2): привязка планировки к рабочему пространству.
--
-- Черновики планировок живут в мире студии (layout_documents → public.projects),
-- а подписанные версии — в мире projectceo (организация → проект → пакет,
-- publish_m2_layout_version). Это две разные таблицы проектов; моста между
-- ними до этой миграции не было. Привязка — и есть мост: она запоминает, в
-- какой пакет публикуются версии планировки.
--
-- Комнат и вариантов как реестра в projectceo нет: roomId — свободный
-- идентификатор, первая публикация с ним и создаёт scope. Поэтому room_id
-- хранится здесь с момента привязки: выводись он из названия каждый раз,
-- переименование планировки молча увело бы публикации в «новую комнату».
--
-- Миграция строго аддитивная: только новые nullable-колонки на собственной
-- таблице контура планировок. Ни одна чужая таблица, политика или функция не
-- меняется; RLS уже покрывает эти колонки построчными политиками 20260808050000.

alter table public.layout_documents
  add column if not exists workspace_project_id uuid,
  add column if not exists workspace_package_id uuid,
  add column if not exists workspace_room_id text,
  add column if not exists workspace_role text;

-- Привязка атомарна: либо её нет целиком, либо есть целиком. Половинная
-- привязка (пакет без комнаты) дала бы публикацию с недоопределённым scope.
alter table public.layout_documents
  drop constraint if exists layout_documents_workspace_binding_atomic;
alter table public.layout_documents
  add constraint layout_documents_workspace_binding_atomic check (
    (
      workspace_project_id is null
      and workspace_package_id is null
      and workspace_room_id is null
      and workspace_role is null
    ) or (
      workspace_project_id is not null
      and workspace_package_id is not null
      and workspace_room_id is not null
      and workspace_role is not null
    )
  );

-- Алфавит room_id — тот же, что закреплён для id сущностей документа
-- (id-charset-contract.test.ts), длина до 160 — лимит commitM2Identifier
-- команды публикации.
alter table public.layout_documents
  drop constraint if exists layout_documents_workspace_room_id_charset;
alter table public.layout_documents
  add constraint layout_documents_workspace_room_id_charset check (
    workspace_room_id is null
    or workspace_room_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{2,159}$'
  );

-- Роль варианта — словарь команды публикации, не расширять без её изменения.
alter table public.layout_documents
  drop constraint if exists layout_documents_workspace_role_values;
alter table public.layout_documents
  add constraint layout_documents_workspace_role_values check (
    workspace_role is null
    or workspace_role in ('preferred', 'value_engineered', 'premium')
  );
