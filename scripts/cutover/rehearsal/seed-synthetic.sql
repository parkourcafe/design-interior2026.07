-- Репетиция переноса: синтетические данные в СТАРОЙ схеме (не production).
-- Аккаунты old-anna@ / old-boris@remhaos.test заводятся через Auth заранее
-- (настоящие хеши паролей). Формы значений повторяют рабочую базу.
begin;
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select 'google-sub-boris', u.id,
  jsonb_build_object('sub', 'google-sub-boris', 'email', u.email, 'email_verified', true),
  'google', now(), now(), now()
from auth.users u where u.email = 'old-boris@remhaos.test';

-- proposal_defaults — как у всех 9 дизайнеров рабочей базы (exclusions,
-- revision_limit, stage_completion; пустых нет).
insert into public.designers (id, name, studio_name, proposal_defaults, profile)
select id, 'Анна Старая', 'Студия Старая', jsonb_build_object('exclusions', jsonb_build_array(), 'revision_limit', 2, 'stage_completion', ''),
  jsonb_build_object('phone', '+7 900 111-22-33', 'email', 'old-anna@remhaos.test')
from auth.users where email = 'old-anna@remhaos.test';
insert into public.designers (id, name, studio_name, proposal_defaults)
select id, 'Борис', 'Борис Дизайн', jsonb_build_object('exclusions', jsonb_build_array(), 'revision_limit', 2, 'stage_completion', '') from auth.users where email = 'old-boris@remhaos.test';

insert into public.projects (id, designer_id, client_name, status, intake_token, passport, created_at) values
  ('a1111111-1111-4111-8111-111111111111', (select id from auth.users where email = 'old-anna@remhaos.test'),
   'Клиент Отправленный', 'proposal_sent', 'old-intake-token-sent-0001',
   '{"object":{"type":"flat","area_m2":64,"city":"Москва"},"asset_horizon":"self_long","household":{"now":"двое взрослых","in_5y":"ребёнок","kids":true,"pets":false},"lifestyle":{"morning_load":"high","bathrooms":1,"cooking":"basic","storage_pressure":"high"},"budget":{"range":[3000000,5000000],"risk_level":"mid","includes_furniture":"yes"},"timeline":{"target":"весна","urgency":"normal"},"style":{"refs":[],"anti":["глянец"],"notes":""},"pain_points":"Нет места для хранения","scope":{"package":null},"source":"recommendation","vision":"Светлая квартира","contact":{"name":"Ольга","phone":"+7 911 000-00-01"}}', now() - interval '20 days'),
  ('a2222222-2222-4222-8222-222222222222', (select id from auth.users where email = 'old-anna@remhaos.test'),
   'Клиент Незавершённый', 'brief_in_progress', 'old-intake-token-open-0002', null, now() - interval '10 days'),
  ('a3333333-3333-4333-8333-333333333333', null,
   'Самостоятельный бриф', 'brief_completed', 'old-intake-token-self-0003',
   '{"object":{"type":"house","area_m2":140,"city":"Казань"},"asset_horizon":"self_long","household":{"now":"двое взрослых","in_5y":"ребёнок","kids":true,"pets":false},"lifestyle":{"morning_load":"high","bathrooms":1,"cooking":"basic","storage_pressure":"high"},"budget":{"range":[3000000,5000000],"risk_level":"mid","includes_furniture":"yes"},"timeline":{"target":"весна","urgency":"normal"},"style":{"refs":[],"anti":["глянец"],"notes":""},"pain_points":"Нет места для хранения","scope":{"package":null},"source":"recommendation","vision":"Светлая квартира","contact":{"name":"Игорь","phone":"+7 911 000-00-03"}}', now() - interval '5 days');

insert into public.answers (project_id, question_id, value) values
  ('a1111111-1111-4111-8111-111111111111', 'object', '{"type":"flat","area_m2":64,"city":"Москва"}'),
  ('a1111111-1111-4111-8111-111111111111', 'contact', '{"name":"Ольга","phone":"+7 911 000-00-01","consent":true}'),
  ('a1111111-1111-4111-8111-111111111111', 'attachments',
   '[{"path":"a1111111-1111-4111-8111-111111111111/1757000000000-plan.png","name":"План.png","size":67,"type":"image/png"}]'),
  ('a1111111-1111-4111-8111-111111111111', 'pain', '"Нет места для хранения"'),
  ('a2222222-2222-4222-8222-222222222222', 'object', '{"type":"flat","area_m2":48,"city":"Тверь"}'),
  ('a3333333-3333-4333-8333-333333333333', 'object', '{"type":"house","area_m2":140,"city":"Казань"}');

insert into public.risk_cards (project_id, risk_type, evidence, impact, confidence, designer_action, proposal_implication, status, source) values
  ('a1111111-1111-4111-8111-111111111111', 'function', array['Утро: 3 человека, 1 санузел'], 'Очередь по утрам', 'high',
   'Обсудить второй санузел', 'Входит: вариант планировки со вторым санузлом', 'accepted', 'rule');

insert into public.proposals (project_id, version, sections, status, public_token, sent_at) values
  ('a1111111-1111-4111-8111-111111111111', 1,
   '[{"id":"task","title":"Задача клиента","body":"Квартира 64 м², Москва"},{"id":"works","title":"Состав работ","body":"Полный дизайн-проект"},{"id":"stages","title":"Этапы и сроки","body":"1. Планировка. 2. Концепция."},{"id":"included","title":"Что входит","body":"Планировка со вторым санузлом"},{"id":"excluded","title":"Что не входит","body":"Закупка мебели"},{"id":"revisions","title":"Лимиты правок","body":"2 круга"},{"id":"client_inputs","title":"Что нужно от клиента","body":"Обмерный план"},{"id":"stage_completion","title":"Условия завершения этапов","body":"Письменное согласование"}]', 'sent', 'old-public-token-0001', now() - interval '15 days');

insert into public.events (designer_id, project_id, type)
select (select id from auth.users where email = 'old-anna@remhaos.test'), 'a1111111-1111-4111-8111-111111111111', t
from unnest(array['intake_link_created','brief_started','brief_completed','proposal_created','proposal_sent','proposal_viewed']) t;
insert into public.events (designer_id, project_id, type) values (null, 'a3333333-3333-4333-8333-333333333333', 'brief_completed');
commit;
