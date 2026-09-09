# M1 bridge model proposal — enrollment

Статус: implementation note after owner decision Р11; не является production GO.
Дата: 2026-09-10.

## Решение владельца

Р11 закрыто владельцем вариантом **(а) enrollment**: legacy M1 project
зачисляется серверно в ProjectCEO organization/project студии при первой
команде M1. Это одна модель владения и один request-bound scope; отдельный
legacy-id без FK не используется.

## Что именно означает enrollment

- Запрос M1 получает `organization_id`, `project_id`, actor и capability
  server-side из authenticated context.
- Legacy project связывается с уже enrolled ProjectCEO project один раз;
  повторный запрос возвращает тот же logical result (idempotent replay).
- Каждая команда остаётся scoped к organization/project и проходит обычные
  capability, tenancy и audit checks. Human operations не используют service
  role как actor.
- Legacy identifiers могут храниться как compatibility metadata, но не
  становятся альтернативным ключом доступа и не обходят RLS.

## Почему не вариант (б)

Lookup по одному legacy id без FK оставил бы две модели владения: legacy
`public.projects` и ProjectCEO organization membership. Это усложняет RLS,
negative tests, replay и rollback и допускает mismatch между проектом и
организацией. Такой lookup не должен быть authorization boundary.

## Последствия для проверок и отката

1. Проверяется owner/project enrollment, повторный enrollment и concurrent
   enrollment с одним победителем и replay для проигравшего.
2. Проверяется отказ cross-organization/project и отсутствие leakage logical
   result, source scope и capability.
3. Enrollment и все M1 commands идут через request-bound contracts; прямые
   private-table INSERTs и service-role human workflow запрещены.
4. Откат означает остановку нового enrollment command и возврат к последнему
   совместимому read-only пути. Существующее enrollment не переписывается и
   не переводится в legacy-id режим без отдельного owner decision.

## Границы

Документ фиксирует последствия уже принятого Р11. Он не создаёт RPC, migration,
grant, production flag или hosted deployment и не заменяет отдельные пакеты
WP-21, WP-23, WP-24 и WP-26.
