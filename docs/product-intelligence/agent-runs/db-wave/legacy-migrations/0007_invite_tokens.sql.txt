-- ─────────────────────────────────────────────────────────────
-- Приглашение в команду по ССЫЛКЕ-ТОКЕНУ вместо совпадения email.
--
-- Закрывает дефект «захват студии»: раньше getStudio() активировал висящее
-- приглашение по простому совпадению user.email со studio_members.email, а
-- регистрация создаёт пользователя без доказанного владения ящиком — значит
-- любой, кто первым зарегистрирует чужой приглашённый адрес, получал доступ
-- owner-уровня к проектам студии.
--
-- Теперь активация требует владения одноразовой ссылкой (invite_token):
-- владелец приглашает → получает ссылку /join/<token> → отправляет коллеге →
-- тот входит и переходит по ссылке. Токен гаснет после первого входа и истекает.
-- ─────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

alter table public.studio_members
  add column if not exists invite_token text,
  add column if not exists token_expires_at timestamptz;

-- Бэкофилл существующих приглашений (действуют 7 дней), чтобы старые строки
-- активировались по ссылке, а не по email.
update public.studio_members
  set invite_token = encode(gen_random_bytes(18), 'hex'),
      token_expires_at = now() + interval '7 days'
  where status = 'invited' and invite_token is null;

create index if not exists studio_members_invite_token_idx
  on public.studio_members (invite_token) where invite_token is not null;
