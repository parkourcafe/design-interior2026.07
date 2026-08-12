\set ON_ERROR_STOP on

-- Классификация поверхности модуля 4 против настоящей базы.
--
-- Матрица живёт в `lib/project-intelligence/delivery/projectceo/m4-surface.ts`,
-- и её строки — утверждения о базе. Утверждение, которое никто не сверял с
-- базой, ошибается молча: у модуля 3 первая редакция матрицы содержала три
-- сигнатуры, написанные по памяти, и поймал их именно такой сценарий.
--
-- Второе, и здесь оно важнее, чем у M3: ни одна функция схемы
-- `projectceo_m4_api` не может существовать, не будучи классифицированной —
-- ни как команда матрицы, ни как явно названная не-команда (воркерный расчёт,
-- воркерный план вех, регистрация документа передачи, читающая RPC). Проверка
-- идёт по ВСЕЙ схеме, а не только по доступному `authenticated`: команды модуля
-- 4 сегодня закрыты все, и проверять только доступное значило бы проверять
-- пустое множество. Новая RPC модуля, добавленная завтра, уронит CI здесь.
--
-- Списки ниже — зеркало матрицы. Их совпадение проверяет
-- `m4-surface-matrix.test.ts`: разойдись они, красным станет юнит-набор.

do $m4_surface_classification$
declare
  v_signature text;
  v_unknown text;
  -- Командные RPC модуля 4 — обе схемы, оба инкремента.
  v_classified text[] := array[
    -- Инкремент 1 (открыт A6, закрыт по умолчанию до явного включения среды).
    'projectceo_product_api.distribute_release_request_bound(uuid, text, uuid, bigint, text)',
    'projectceo_product_api.distribute_release(uuid, text, uuid, bigint, text)',
    'projectceo_product_api.acknowledge_release_request_bound(uuid, uuid, text, bigint, text)',
    'projectceo_product_api.acknowledge_release(uuid, uuid, text, bigint, text)',
    'projectceo_m4_api.submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, bigint, text)',
    'projectceo_m4_api.replay_submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, text)',
    -- V1 Impact (DEC-033): ревью уже посчитанного влияния — тоже инкремент 1,
    -- закрыт по умолчанию до явного включения среды, как и остальное выше.
    'projectceo_m4_api.review_change_impact(uuid, uuid, text, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_change_impact(uuid, uuid, text, text, text, text)',
    -- V2/V3 (не открыты ничем).
    'projectceo_m4_api.register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, bigint, text)',
    'projectceo_m4_api.replay_register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, text)',
    'projectceo_m4_api.review_photo_evidence(uuid, uuid, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_photo_evidence(uuid, uuid, text, text, text)',
    'projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text)',
    'projectceo_m4_api.replay_accept_milestone(uuid, uuid, text)',
    'projectceo_m4_api.build_construction_handover(uuid, uuid, text, bigint, text)'
  ];
  -- Функции схемы, у которых человеческой команды нет вовсе.
  v_non_commands text[] := array[
    'calculate_change_impact',
    'define_milestone',
    'register_handover_document',
    'get_execution_delivery',
    -- V1 Impact: воркерные двери расчёта. Человеческой команды у них нет и не
    -- будет — расчёт влияния делает система (DEC-032 §3).
    'calculate_change_impact_policy_bound',
    'list_change_impact_backlog',
    -- V1 Impact: durable operator failure поверх воркерной двери расчёта.
    'record_change_impact_worker_failure',
    'redrive_change_impact_worker_failure'
  ];
begin
  -- 1. Каждая сигнатура матрицы существует. `to_regprocedure` возвращает null
  --    на несуществующую функцию вместо ошибки, поэтому проверка явная.
  foreach v_signature in array v_classified loop
    if to_regprocedure(v_signature) is null then
      raise exception 'DB4_M4_SURFACE_SIGNATURE_NOT_FOUND:%', v_signature;
    end if;
  end loop;

  -- 2. Вся схема модуля классифицирована: либо команда матрицы, либо названная
  --    не-команда. Третьего состояния нет.
  select p.oid::regprocedure::text into v_unknown
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'projectceo_m4_api'
    and not (p.proname = any (v_non_commands))
    and not exists (
      select 1
      from unnest(v_classified) signature
      where to_regprocedure(signature) = p.oid
    )
  limit 1;
  if v_unknown is not null then
    raise exception 'DB4_M4_RPC_UNCLASSIFIED:%', v_unknown;
  end if;

  -- 3. Названная не-команда обязана существовать: список, который расходится с
  --    базой, скрывает ровно то, ради чего он написан.
  foreach v_signature in array v_non_commands loop
    if not exists (
      select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'projectceo_m4_api'
        and p.proname = v_signature
    ) then
      raise exception 'DB4_M4_NON_COMMAND_NOT_FOUND:%', v_signature;
    end if;
  end loop;
end
$m4_surface_classification$;

\echo DB4_M4_SURFACE_CLASSIFICATION_OK
