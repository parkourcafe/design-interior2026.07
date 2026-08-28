-- Сведение двух дверей выдачи/подтверждения к одной (M4 backlog #2).
--
-- ЧТО БЫЛО. У выдачи и подтверждения жили ДВЕ двери каждая: request-bound
-- версии (`20260718124958`), которые зовёт приложение, и прежние
-- `distribute_release` / `acknowledge_release` (`20260717101000`), которых не
-- звал никто, кроме `tests/db4/20_product_operations.sql`. Отозвать прежние
-- насмерть значило потерять то покрытие; держать обе — значит держать два
-- пути с самостоятельно расходящейся семантикой.
--
-- ПОРЯДОК — строго по backlog: сначала покрытие семантики (чужой получатель,
-- чужой хеш, чужая область получателя) ПЕРЕНЕСЕНО на request-bound двери
-- (правка `tests/db4/20_product_operations.sql` этим же PR; сами проверки в
-- request-bound телах существовали с рождения — они copy-forward прежних),
-- ЗАТЕМ прежние двери выведены из строя. Request-bound семантика — строгое
-- надмножество прежней: сверх неё только привязка ключа к актору
-- (IDEMPOTENCY_ACTOR_MISMATCH) и невключение expected_state_revision в
-- request digest.
--
-- КАК ИМЕННО ВЫВЕДЕНЫ. Тела заменены на безусловный отказ
-- `LEGACY_DOOR_RETIRED_USE_REQUEST_BOUND`; сигнатуры, владелец и гранты НЕ
-- тронуты. Это сознательный выбор против DROP:
--   * `tests/ap1/environment/enable-m4-increment-1.sql` (зона Фазы 1) грантует
--     эти сигнатуры поимённо — DROP уронил бы чужой скрипт; замена тела
--     оставляет его валидным, а дверь мёртвой при любом гранте;
--   * матрица `m4-surface.ts` (зона Фазы 2 до её PR-3) и guardrail
--     `20260811020000` сверяются с этими сигнатурами по счёту — DROP разорвал
--     бы сверку в чужих зонах. Физическое удаление сигнатур из матрицы,
--     enable-скрипта и адаптера — отдельная координация после мерджа PR-3.
-- «Дверь недостижима, но покрытие живо»: недостижимость по существу — отказ
-- тела при ЛЮБОМ гранте — проверяется guard'ом здесь и сценарием db4/20.
--
-- Словарь операций и исторические записи `command_records` не трогаются:
-- прежние операции остаются законными в истории.

begin;

set local check_function_bodies = on;

create or replace function projectceo_product_api.distribute_release(
  project_id uuid,
  artifact_id text,
  recipient_user_id uuid,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  perform projectceo_product._raise(
    'P1111',
    'validation_failed',
    '{"reason":"LEGACY_DOOR_RETIRED_USE_REQUEST_BOUND"}'::jsonb
  );
  return null;
end
$function$;

create or replace function projectceo_product_api.acknowledge_release(
  project_id uuid,
  distribution_id uuid,
  expected_semantic_hash text,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  perform projectceo_product._raise(
    'P1111',
    'validation_failed',
    '{"reason":"LEGACY_DOOR_RETIRED_USE_REQUEST_BOUND"}'::jsonb
  );
  return null;
end
$function$;

-- Guard: прежние двери мертвы по существу (отказ при вызове владельцем — то
-- есть при максимально возможных правах), request-bound двери на месте, их
-- гранты и семантика не тронуты этой миграцией.
do $guard$
begin
  begin
    perform projectceo_product_api.distribute_release(
      '00000000-0000-4000-8000-000000000000', 'probe',
      '00000000-0000-4000-8000-000000000001', 1, 'retire-guard-probe'
    );
    raise exception 'PROJECTCEO_LEGACY_DISTRIBUTE_STILL_ALIVE';
  exception
    when sqlstate 'P1111' then
      if sqlerrm not like 'validation_failed%' then raise; end if;
  end;

  begin
    perform projectceo_product_api.acknowledge_release(
      '00000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000001',
      'sha256:' || repeat('0', 64), 1, 'retire-guard-probe'
    );
    raise exception 'PROJECTCEO_LEGACY_ACKNOWLEDGE_STILL_ALIVE';
  exception
    when sqlstate 'P1111' then
      if sqlerrm not like 'validation_failed%' then raise; end if;
  end;

  if to_regprocedure(
    'projectceo_product_api.distribute_release_request_bound(uuid, text, uuid, bigint, text)'
  ) is null or to_regprocedure(
    'projectceo_product_api.acknowledge_release_request_bound(uuid, uuid, text, bigint, text)'
  ) is null then
    raise exception 'PROJECTCEO_REQUEST_BOUND_DOORS_MISSING';
  end if;
end
$guard$;

commit;
