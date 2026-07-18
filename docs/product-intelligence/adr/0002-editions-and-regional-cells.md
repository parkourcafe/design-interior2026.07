# ADR-0002: Две редакции, два региональных deployment cell

Статус: **partially superseded ADR-0004**. Дата исходного решения: 16 июля 2026.

Product-edition решение ArchiDom Studio/ProUp отменено 18 июля 2026 года. Сохраняется
только принцип физической изоляции data-plane при появлении второго региона; сейчас
исполняется один RU cell, а будущий регион требует отдельного ADR.

## Контекст

ArchiDom Studio и ProUp Renovation используют общую проектную логику, но обслуживают разные jobs-to-be-done. США и Россия имеют разные требования к данным, AI-провайдерам, документам, платежам и интеграциям.

## Решение

- Общий source repository и Project Intelligence Core.
- Edition-specific journeys и capability composition.
- Отдельные databases, storage, backups, logs, secrets и AI routing для `us` и `ru`.
- Никакого runtime-переключения региона существующего tenant.

## Последствия

- нет fork двух кодовых баз;
- локализация не подменяет продуктовую редакцию;
- deployment/operations становятся двумя контурами;
- cross-region analytics требует отдельного privacy design.
