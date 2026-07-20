-- ─────────────────────────────────────────────────────────────
-- S3 «Лестницы запуска» (CLAUDE.md): завершение сделки в публичном КП.
-- Решение клиента (accept/discuss/changes) и факт первого просмотра были
-- реализованы только событиями в `events` (сканирование + сортировка по
-- created_at при каждом заходе на /p/[token]). Здесь — источник истины
-- переносится на саму строку proposals: быстрее читать, и первый ответ
-- фиксируется атомарным UPDATE ... WHERE client_response IS NULL вместо
-- select-затем-insert (была гонка при одновременных кликах).
--
-- Запись в events сохраняется (см. app/api/proposal/respond/route.ts) —
-- это исторический лог для будущей аналитики, columns — путь чтения.
-- ─────────────────────────────────────────────────────────────

alter table public.proposals
  add column if not exists client_response text
    check (client_response in ('proposal_accepted','proposal_discussion_requested','proposal_changes_requested')),
  add column if not exists client_response_at timestamptz,
  add column if not exists first_viewed_at timestamptz;

create index if not exists proposals_client_response_idx
  on public.proposals (client_response) where client_response is not null;
