\set ON_ERROR_STOP on

-- V1 Impact: заявка, на которой доказывается КОНКУРЕНТНЫЙ расчёт.
--
-- ЗАЧЕМ ОТДЕЛЬНАЯ ЗАЯВКА. Гейт V1 требует доказать, что два параллельных
-- прохода воркера дают ровно один прогон. На заявке золотого проекта это
-- недоказуемо: к моменту конкурентной стадии у неё прогон уже есть
-- (`20_execution_operations.sql`), и оба соперника получили бы
-- `IMPACT_ALREADY_CALCULATED` — проверялся бы не race, а повторный вызов.
--
-- Завести вторую заявку через `submit_change_request` тоже нельзя: проект
-- допускает одну открытую заявку, и RPC отвечает
-- `CHANGE_TRANSITION_ALREADY_SUBMITTED`. Это не ограничение теста, а правило
-- предметной области, и обходить его в продуктовом коде нечем.
--
-- Поэтому заявка собирается ПРЯМОЙ ЗАПИСЬЮ — как фикстура, а не как поведение
-- продукта. Предмет проверки — расчёт влияния под гонкой, и он идёт через
-- НАСТОЯЩУЮ RPC. Сборка заявки в предмет проверки не входит: её собственный
-- путь доказан в `20_execution_operations.sql` вызовом
-- `submit_change_request`.
--
-- Файл НЕ откатывается: конкурентный прогон (`run-concurrency.zsh`) идёт
-- отдельными сессиями, а они видят только зафиксированные данные.

begin;

-- Корни и ссылки берутся из существующей заявки, а не выдумываются: узел и
-- ревизия обязаны существовать в целевой версии графа, иначе обход не найдёт
-- ничего и «один прогон» доказывался бы на пустом результате.
--
-- Пакет берётся ВТОРОЙ: переход baseline уникален в пределах пакета
-- (`m4_change_request_transition_key`), и повторить его на том же пакете нельзя.
-- Версия графа определяется baseline проекта, а не пакетом, поэтому обход
-- находит то же самое.
insert into projectceo_m4.change_requests (
  organization_id,
  project_id,
  change_request_id,
  package_id,
  from_baseline_id,
  proposed_baseline_id,
  from_production_package_version_id,
  protected_reason,
  reason_digest,
  initiator_role,
  delta_cost_rub,
  delta_days,
  requested_by_user_id
)
select
  cr.organization_id,
  cr.project_id,
  'c0ffee00-0000-4000-8000-000000000001'::uuid,
  other.package_id,
  cr.from_baseline_id,
  cr.proposed_baseline_id,
  -- Пакет и его версия выбираются ВМЕСТЕ: FK требует, чтобы версия
  -- принадлежала именно этому пакету и именно исходному baseline.
  other.production_package_version_id,
  'Concurrent impact calculation fixture',
  project_intelligence._sha256_text('Concurrent impact calculation fixture'),
  cr.initiator_role,
  1000,
  1,
  cr.requested_by_user_id
from projectceo_m4.change_requests cr
join lateral (
  select version.package_id, version.production_package_version_id
  from projectceo_product.production_package_versions version
  join projectceo_product.project_baseline_packages target
    on target.organization_id = version.organization_id
   and target.project_id = version.project_id
   and target.package_id = version.package_id
   and target.baseline_id = cr.proposed_baseline_id
  where version.organization_id = cr.organization_id
    and version.project_id = cr.project_id
    and version.baseline_id = cr.from_baseline_id
    and version.package_id <> cr.package_id
  limit 1
) other on true
where cr.project_id = '41111111-1111-4111-8111-111111111111'
  and cr.change_request_id <> 'c0ffee00-0000-4000-8000-000000000001'::uuid
limit 1;

insert into projectceo_m4.change_request_roots (
  organization_id,
  project_id,
  change_request_id,
  package_id,
  from_baseline_id,
  proposed_baseline_id,
  target_kind,
  node_id,
  from_revision_id,
  to_revision_id
)
select
  root.organization_id,
  root.project_id,
  'c0ffee00-0000-4000-8000-000000000001'::uuid,
  (
    select fixture.package_id
    from projectceo_m4.change_requests fixture
    where fixture.project_id = root.project_id
      and fixture.change_request_id
        = 'c0ffee00-0000-4000-8000-000000000001'::uuid
  ),
  root.from_baseline_id,
  root.proposed_baseline_id,
  root.target_kind,
  root.node_id,
  root.from_revision_id,
  root.to_revision_id
from projectceo_m4.change_request_roots root
where root.project_id = '41111111-1111-4111-8111-111111111111'
  and root.change_request_id <> 'c0ffee00-0000-4000-8000-000000000001'::uuid;

do $db5_concurrency_fixture$
declare
  v_roots integer;
begin
  select count(*) into v_roots
  from projectceo_m4.change_request_roots root
  where root.project_id = '41111111-1111-4111-8111-111111111111'
    and root.change_request_id = 'c0ffee00-0000-4000-8000-000000000001'::uuid;
  -- Заявка без корней дала бы пустое влияние, и «ровно один прогон»
  -- подтвердилось бы на результате, которого нет.
  if v_roots = 0 then
    raise exception 'DB5_CONCURRENCY_FIXTURE_HAS_NO_ROOTS';
  end if;

  -- Прогона у неё быть не должно: гонка обязана начинаться с пустого места.
  if exists (
    select 1
    from projectceo_m4.impact_runs run
    where run.project_id = '41111111-1111-4111-8111-111111111111'
      and run.change_request_id = 'c0ffee00-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception 'DB5_CONCURRENCY_FIXTURE_ALREADY_CALCULATED';
  end if;
end
$db5_concurrency_fixture$;

commit;

select 'DB5_IMPACT_CONCURRENCY_FIXTURE_OK' as result;
