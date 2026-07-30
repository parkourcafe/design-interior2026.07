# ProjectCEO RU — Kora Pilot Runbook

Дата: 17 июля 2026 года.
Назначение: 10–15 минут deterministic walkthrough UI vertical slice.

## Preconditions

```bash
npm install
npm run dev
```

Нужна существующая authenticated dashboard session. Открыть:

```text
/dashboard/projectceo
```

Deployable UI не содержит переключатель роли. Для локальной проверки одного
sanitized role projection роль задаётся server-side до запуска:

```bash
PROJECTCEO_DEMO_ROLE=owner npm run dev
```

Допустимые значения: `owner`, `architect`, `builder`, `client`, `guest`. После
смены значения dev server перезапускается. URL/query/client state роль не меняют.
Одновременно браузер получает только DTO выбранной server role.

## 1. Portfolio и onboarding

1. Убедиться, что показаны три оплаченных pilot scopes.
2. Проверить Kora: 1 800 м², 209 physical records, 81 materialized,
   128 placeholders.
3. В Owner UI открыть onboarding.
4. Переключить `Полный проект` / `Точный рабочий пакет`.
5. Проверить пояснение: рабочий пакет не создаёт отдельный Project.
6. Создать local invitation preview, скопировать безопасную ссылку.
7. Проверить pending/accepted/revoked/expired invitation и grant states.
8. Для active grant нажать `Отозвать` и подтвердить irreversible action.

Ожидание: raw token/email не появляются в analytics или audit projection.

## 2. Kora workspace

Открыть:

```text
/dashboard/projectceo/projects/kora-food-hall
```

Проверить:

- один полный Project, 1 800 м²;
- пять delivery packages;
- вкладки не создают отдельные проекты;
- статическую server-derived роль текущей сессии;
- scenario switcher ready/loading/empty/error/stale/revoked/expired.

## 3. Source registry

Запустить server role `owner` или `architect`:

1. Открыть `Источники`.
2. Убедиться, что registry содержит 209 безопасных записей.
3. Отфильтровать `materialized` — 81.
4. Отфильтровать `placeholder` — 128.
5. Найти `SRC-014`.
6. Проверить exact context, checksum projection, duplicates, quarantine.
7. Выполнить local human state: confirm, reject, request clarification.

Ожидание: original filenames и локальные пути отсутствуют; AI не утверждает
источник.

## 4. Решения и материалы

1. Открыть `Решения и материалы`.
2. Проверить Decision revision и evidence source revision/locator.
3. Проверить Selection revision 2 и superseded revision 1.
4. Проверить verified price observation 1 480 000 ₽ и дату проверки.
5. Перезапустить локальный server с `PROJECTCEO_DEMO_ROLE=client` и выполнить
   local approve/reject/request change.

Ожидание: состояние изменяется только в UI preview; production persistence не
заявляется.

## 5. Baseline и выдача

1. Открыть `Baseline`.
2. Проверить published V2, zero blocker и semantic hash.
3. Проверить V1→V2 diff и immutable V1 indicator.
4. Открыть `Выдачи`.
5. Проверить current V2 и superseded V1.
6. Поочерёдно запустить server role `builder`, `client`, `guest` и подтвердить
   получение current exact version/hash.

Ожидание: guest видит только exact Architecture package current release.

## 6. Change, photo, handover

1. Открыть `Изменения`.
2. Проверить Kora ChangeRequest:
   - Baseline V1 → V2;
   - +180 000 ₽;
   - +2 дня;
   - 3 impacts;
   - 2 human dispositions.
3. Создать local ChangeRequest preview.
4. На `Обзор` проверить два photo milestones и 20 photo records.
5. Запустить `PROJECTCEO_DEMO_ROLE=builder` и нажать `Добавить фото к milestone`.
6. Проверить handover: 1/2 zones accepted, 4 warranty documents,
   archive status `not_ready`.

Ожидание: handover hash не создаётся до полной human acceptance.

## 7. Role isolation

Guest:

- видит `Обзор` и `Выдачи`;
- не видит source registry, participants, invitation/grants, history;
- получает exact package only.

Builder и Client:

- не видят owner access administration;
- не публикуют baseline/release;
- могут пройти разрешённый participant flow.

Owner:

- видит весь UI и access administration.

Ролевую матрицу нельзя собирать в одном deployable client bundle. Полный
sanitized cross-role walkthrough существует только как test harness
`tests/projectceo-ui/role-harness.ts`.

## 8. Automated gate

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Все четыре команды должны завершиться с кодом `0`.

## Stop conditions

Не переходить к production adoption, если:

- UI adapter читает private tables напрямую;
- human command использует service role;
- actor/project/package/role приходят из client JSON без server derivation;
- guest может перечислить sibling package/project/member/source/audit;
- original filename, raw token или signed URL попадает в audit/analytics;
- persisted Foundation tests или authenticated browser QA не зелёные.
