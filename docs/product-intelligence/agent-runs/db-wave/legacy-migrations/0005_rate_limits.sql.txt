-- ─────────────────────────────────────────────────────────────
-- Rate limiting для публичных server routes (auth/register, client/create,
-- intake/submit). Durable-счётчик по ключу «action:ip» в окне времени —
-- in-memory на Vercel не работает (разные инстансы). Запись/чтение только
-- service-role'ом из роутов; anon доступа нет.
--
-- Помощник `checkRateLimit` (lib/rate-limit.ts) — fail-open: если этой таблицы
-- нет (миграция не применена) или запрос упал, запрос пропускается, продукт
-- не ломается.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.rate_limits (
  id bigint generated always as identity primary key,
  key text not null,                       -- 'register:1.2.3.4'
  created_at timestamptz not null default now()
);

create index if not exists rate_limits_key_created_idx
  on public.rate_limits (key, created_at desc);

alter table public.rate_limits enable row level security;
-- Политик нет намеренно: доступ только через server route с service role.

-- Гигиена: старые записи можно периодически чистить (не критично для MVP):
--   delete from public.rate_limits where created_at < now() - interval '2 days';
