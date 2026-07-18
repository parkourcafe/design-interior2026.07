# ProjectCEO RU — локальный browser QA

## Безопасный read-only маршрут

В development доступны пять детерминированных Kora-представлений:

- `/projectceo-qa/owner`;
- `/projectceo-qa/architect`;
- `/projectceo-qa/builder`;
- `/projectceo-qa/client`;
- `/projectceo-qa/guest`.

Маршрут использует только sanitized Kora fixture, не требует Supabase-сессии и при `NODE_ENV=production` всегда вызывает `notFound()`. Он не доказывает authenticated PostgREST/RLS и не является production bypass.

## Что проверить

1. Kora отображается как один полноразмерный проект около 1 800 м².
2. Переключение ролей меняет только разрешённую DTO-проекцию.
3. Guest видит только exact package/current release и не видит sources, participants, audit или changes.
4. Archive/CAD и production filenames/локальные пути не попадают в публичный UI.
5. Immutable releases, change impact, milestone photos и handover readiness отображаются без выдуманного завершения.
6. Все fixture mutations отключены или завершаются контролируемой ошибкой; локального synthetic success нет.

Authenticated browser QA выполняется отдельно после production-adoption решения, публикации API schemas и появления реальных тестовых пользователей/данных.
