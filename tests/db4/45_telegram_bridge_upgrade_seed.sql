\set ON_ERROR_STOP on

-- Состояние базы ПЕРЕД миграцией `20260811070000`.
--
-- Смысл файла — не фикстуры, а время. Корректирующая миграция нормализует
-- существующие строки: возвращает осиротевшие `sending` в очередь и закрывает
-- приём у связей, которым уведомление так и не публиковали. На пустой базе
-- обе ветки нормализации не исполняются вовсе, поэтому чистый прогон
-- миграционной цепочки НИЧЕГО о них не доказывает — а первая редакция
-- `070000` добавляла constraint раньше нормализации и на такой строке упала бы.
--
-- Поэтому здесь заводится минимальный, но НАСТОЯЩИЙ набор: две связи в
-- состоянии, которое умела создавать прежняя реализация, и одна запись очереди
-- в `sending` без токена аренды — потому что токена в прежней схеме не было.

insert into auth.users (id, email, email_confirmed_at)
values ('51111111-1111-4111-8111-111111111111', 'upgrade@remhaos.test', statement_timestamp());

insert into public.designers (id, name, studio_name)
values ('51111111-1111-4111-8111-111111111111', 'Upgrade', 'Upgrade Studio');

insert into public.projects (id, designer_id, client_name, status, intake_token)
values
  ('52222222-2222-4222-8222-222222222222',
   '51111111-1111-4111-8111-111111111111', 'Notified', 'active_project', 'upgrade-notified'),
  ('53333333-3333-4333-8333-333333333333',
   '51111111-1111-4111-8111-111111111111', 'Silent', 'active_project', 'upgrade-silent');

insert into project_intelligence.organizations (id, cell_code, edition, legacy_designer_id)
values ('54444444-4444-4444-8444-444444444444', 'ru', 'renovation',
  '51111111-1111-4111-8111-111111111111');

insert into project_intelligence.project_workflows (organization_id, project_id)
values
  ('54444444-4444-4444-8444-444444444444', '52222222-2222-4222-8222-222222222222'),
  ('54444444-4444-4444-8444-444444444444', '53333333-3333-4333-8333-333333333333');

-- Членство и право — не украшение фикстуры. Финализация подключения
-- перепроверяет их заново, поэтому база без них доказывала бы только то, что
-- отказ работает.
insert into project_intelligence.organization_members (organization_id, user_id, role)
values ('54444444-4444-4444-8444-444444444444',
  '51111111-1111-4111-8111-111111111111', 'owner');

insert into projectceo_foundation.project_memberships (
  organization_id, project_id, user_id, role
)
values
  ('54444444-4444-4444-8444-444444444444', '52222222-2222-4222-8222-222222222222',
   '51111111-1111-4111-8111-111111111111', 'owner_lead'),
  ('54444444-4444-4444-8444-444444444444', '53333333-3333-4333-8333-333333333333',
   '51111111-1111-4111-8111-111111111111', 'owner_lead');

insert into projectceo_foundation.project_member_capabilities (
  organization_id, project_id, user_id, capability
)
values
  ('54444444-4444-4444-8444-444444444444', '52222222-2222-4222-8222-222222222222',
   '51111111-1111-4111-8111-111111111111', 'manage_project_integrations'),
  ('54444444-4444-4444-8444-444444444444', '53333333-3333-4333-8333-333333333333',
   '51111111-1111-4111-8111-111111111111', 'manage_project_integrations');

insert into remhaos_channel.channel_identity_links (provider, external_user_id, user_id)
values ('telegram', 888001, '51111111-1111-4111-8111-111111111111');

-- Связь, участников которой уведомили: приём у неё сохраняется.
insert into remhaos_channel.project_channel_bindings (
  organization_id, project_id, provider, bot_instance_id,
  external_chat_id, external_chat_type, status, notice_version,
  notice_posted_at, initiated_by_user_id, activated_at
)
values (
  '54444444-4444-4444-8444-444444444444', '52222222-2222-4222-8222-222222222222',
  'telegram', 'upgrade-bot', -200100, 'supergroup', 'active', 'notice-v1',
  statement_timestamp(), '51111111-1111-4111-8111-111111111111', statement_timestamp()
);

-- Связь, которую прежняя реализация сделала активной, ничего не опубликовав.
-- Именно такие и создавались до исправления: уведомление уходило ПОСЛЕ
-- активации и «не блокировало подключение».
insert into remhaos_channel.project_channel_bindings (
  organization_id, project_id, provider, bot_instance_id,
  external_chat_id, external_chat_type, status, notice_version,
  notice_posted_at, initiated_by_user_id, activated_at
)
values (
  '54444444-4444-4444-8444-444444444444', '53333333-3333-4333-8333-333333333333',
  'telegram', 'upgrade-bot', -200200, 'supergroup', 'active', 'notice-v1',
  null, '51111111-1111-4111-8111-111111111111', statement_timestamp()
);

-- Настоящая осиротевшая запись очереди: `sending` с истёкшей арендой и без
-- токена. В прежней схеме колонки `lease_token` не существовало, поэтому после
-- добавления она окажется NULL — и constraint формы аренды обязан
-- валидироваться уже ПОСЛЕ нормализации, иначе миграция упадёт здесь.
insert into remhaos_channel.notification_outbox (
  organization_id, project_id, binding_id, source_kind, source_id,
  template_version, payload, idempotency_key, state, attempt_count,
  lease_expires_at, next_attempt_at
)
select
  b.organization_id, b.project_id, b.binding_id, 'release_distribution',
  'upgrade-dist-1', 'telegram-release/1', '{"projectName":"Upgrade"}'::jsonb,
  'release_distribution:upgrade-dist-1', 'sending', 3,
  statement_timestamp() - interval '5 minutes',
  statement_timestamp() - interval '5 minutes'
from remhaos_channel.project_channel_bindings b
where b.external_chat_id = -200100;

-- И одна запись, которой нормализация касаться НЕ должна: `sent` терминален.
insert into remhaos_channel.notification_outbox (
  organization_id, project_id, binding_id, source_kind, source_id,
  template_version, payload, idempotency_key, state, attempt_count,
  sent_at, external_message_id
)
select
  b.organization_id, b.project_id, b.binding_id, 'release_distribution',
  'upgrade-dist-0', 'telegram-release/1', '{"projectName":"Upgrade"}'::jsonb,
  'release_distribution:upgrade-dist-0', 'sent', 1,
  statement_timestamp() - interval '1 hour', 4242
from remhaos_channel.project_channel_bindings b
where b.external_chat_id = -200100;

do $seed_is_real$
begin
  if (select count(*) from remhaos_channel.notification_outbox where state = 'sending') <> 1 then
    raise exception 'DB4_TGU_SEED_MISSING_SENDING_ROW';
  end if;
  if (select count(*) from remhaos_channel.project_channel_bindings where status = 'active') <> 2 then
    raise exception 'DB4_TGU_SEED_MISSING_ACTIVE_BINDINGS';
  end if;
end
$seed_is_real$;

\echo DB4_TELEGRAM_UPGRADE_SEEDED
