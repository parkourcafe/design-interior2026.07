-- Guardrail модуля 4: вторая граница — база.
--
-- Основание: `docs/canonical/remhaos-v1/REMHAOS_GUARDRAIL_DECISION_M4_FLAG.md`,
-- подписан владельцем 10.08.2026. Решение ничего не открывает — оно запрещает.
--
-- Находка, ради которой миграция и существует (guardrail §3). Схема
-- `projectceo_m4_api` отдана Data API (`supabase/config.toml`), а её командные
-- RPC были выданы роли `authenticated` (`20260717103000`, строка 2481). Значит
-- любая аутентифицированная сессия могла позвать их напрямую через PostgREST,
-- минуя приложение целиком. Флаг `REMHAOS_EXECUTION_ENABLED` такого вызова не
-- видит: он живёт в TypeScript, а вызов до TypeScript не доходит.
--
-- Один флаг без этой миграции ОПИСЫВАЛ бы запрет, а не создавал его. Поэтому
-- границы две, и обе — кодом.
--
-- Что НЕ отзывается: `get_execution_delivery`. Это читающая RPC, её зовёт живое
-- рабочее пространство (`live-read-port.ts` → executionPackages). Ради неё
-- схема и остаётся отданной; отзыв прав на неё сломал бы чтение проекта.
--
-- Открытие инкремента 1 (A6, DEC-025) вернёт `execute` ТОЧЕЧНО на три RPC и
-- отдельной миграцией — после гейта 1, а не сейчас.

begin;

-- Отзыв исчерпывающий, а не по списку имён. Ручной перечень уже подвёл при
-- подготовке этой миграции: кроме семи команд роли `authenticated` были выданы
-- ещё пять `replay_*`-обёрток, и они прошли бы мимо запрета. Сплошной отзыв с
-- одним явным исключением закрывает и то, чего сегодня нет: команда, добавленная
-- в схему завтра, окажется закрытой по умолчанию, а не открытой по недосмотру.
revoke execute on all functions in schema projectceo_m4_api from authenticated;

-- Единственное исключение — читающая RPC рабочего пространства.
grant execute on function
  projectceo_m4_api.get_execution_delivery(uuid, uuid)
  to authenticated;

-- Запрет, который никто не проверяет, — это комментарий. Миграция обязана
-- упасть здесь, если она не достигла цели или задела лишнее.
do $guard$
declare
  v_leftover text;
begin
  select p.proname into v_leftover
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'projectceo_m4_api'
    and p.proname <> 'get_execution_delivery'
    and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
  limit 1;
  if v_leftover is not null then
    raise exception 'PROJECTCEO_M4_COMMAND_STILL_REACHABLE:%', v_leftover;
  end if;

  -- ...и ровно одно исключение обязано уцелеть, иначе рабочее пространство
  -- перестанет читаться, а это уже не guardrail, а поломка.
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_m4_api.get_execution_delivery(uuid, uuid)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_M4_DELIVERY_READ_LOST';
  end if;
end
$guard$;

commit;
