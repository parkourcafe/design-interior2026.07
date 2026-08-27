# OWNER DECISION — M4 V2/V3 disposable GO

Статус: **DISPOSABLE-ONLY GO**
Дата: 27.08.2026
Основание: отдельное разрешение владельца в текущей рабочей сессии

## 1. Решение

Разрешается локальная реализация и проверка M4 V2/V3 только на disposable
Supabase в составе AP1/AP6. Разрешённые human-facing двери:

- `upload_photo_evidence` через `register_photo_evidence` и `replay_register_photo_evidence`;
- `review_photo_evidence` и `replay_review_photo_evidence`;
- `accept_milestone` и `replay_accept_milestone`.

Кодовый флаг `REMHAOS_M4_V2_V3_ENABLED` выключен по умолчанию и включается
только environment script disposable-стенда. Production adoption и
`M4_PRODUCTION_ENABLED` этим решением не открываются.

## 2. Неизменяемые ограничения

`calculate_change_impact`, `calculate_change_impact_policy_bound`,
`build_construction_handover` и `build_handover` остаются worker-only или
закрытыми согласно существующему контракту. Прямой доступ из production к
V2/V3 не предоставляется. Human operations не используют service role.

Решение не изменяет Integration Gateway, Google Drive, Telegram, OAuth, Picker,
RemHaOS 1 migrations или production project
`ztnycrchwxqczqbyegnp`. Existing timestamped migrations не переписываются.

## 3. Evidence contract

Закрытие этого GO требует:

1. DB4/DB5 проверяют, что новые V2/V3 signatures присутствуют, по умолчанию
   закрыты и не открывают `build_handover`.
2. Disposable enable script выдаёт права только authenticated и сохраняет
   internal-owner/ACL guard.
3. AP1 повторяет authenticated Kora flow и AP6 внешний Tashkent package с
   реальными command/audit receipts и replay.
4. Combined Cycle 7 получает `EXTERNAL_REAL_PACKAGE_PASS`; до этого AP6
   остаётся pending.

Это решение разрешает проверку поверхности, но не является доказательством
production readiness. Отдельный production adoption gate обязателен.
