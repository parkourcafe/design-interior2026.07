-- Аудит 28.09, шаг 4: согласие на обработку персональных данных фиксируется
-- на сервере. Раньше галочка проверялась только в браузере, а на сервере
-- хранилась лишь как поле внутри ответа без времени и версии текста.
--
-- Запись делает маршрут отправки брифа (service role) ДО сохранения ответов;
-- без согласия бриф не принимается. Время ставит база, версия и хеш текста —
-- приложение (lib/legal/consent.ts). Журнал append-only: исправить или удалить
-- запись нельзя никому, включая владельца таблицы. Документы о ПДн остаются в
-- статусе проекта — версия это говорит сама (`consent-draft-…`).

begin;

create table public.intake_consent_records (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete restrict,
  consent_version text not null
    check (consent_version ~ '^[a-z0-9][a-z0-9.-]{2,79}$'),
  consent_text_sha256 text not null
    check (consent_text_sha256 ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('designer_intake', 'self_serve_intake')),
  consented_at timestamptz not null default statement_timestamp()
);

create index intake_consent_records_project_idx
  on public.intake_consent_records (project_id, consented_at desc);

create function public.reject_intake_consent_mutation()
returns trigger
language plpgsql
as $function$
begin
  raise exception using errcode = '55000', message = 'INTAKE_CONSENT_RECORD_IMMUTABLE';
end
$function$;

create trigger intake_consent_records_append_only
  before update or delete on public.intake_consent_records
  for each row execute function public.reject_intake_consent_mutation();

alter table public.intake_consent_records enable row level security;
alter table public.intake_consent_records force row level security;
revoke all on table public.intake_consent_records
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function public.reject_intake_consent_mutation()
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
-- Только серверный маршрут брифа пишет и читает (время согласия задаёт база).
grant insert (project_id, consent_version, consent_text_sha256, source), select
  on table public.intake_consent_records to service_role;

commit;
