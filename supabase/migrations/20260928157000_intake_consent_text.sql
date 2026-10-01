-- Точный текст согласия рядом с записью (оценка ПДн 01.10.2026: «дополнить
-- доказательство точным архивным текстом»). Согласие теперь называет студию
-- дизайнера и сервис RemHaOS, то есть текст у каждой студии свой: одного хеша
-- шаблона мало. Сервер собирает текст сам (lib/legal/consent.ts) и пишет его
-- вместе с хешем; клиент текст не присылает. Старые записи — без текста.

begin;

alter table public.intake_consent_records
  add column consent_text text
    check (consent_text is null or char_length(consent_text) between 20 and 2000);

alter table public.intake_consent_records
  add constraint intake_consent_records_text_hash_check
    check (consent_text is null or consent_text_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(consent_text, 'UTF8')), 'hex'));

grant insert (consent_text) on public.intake_consent_records to service_role;

commit;
