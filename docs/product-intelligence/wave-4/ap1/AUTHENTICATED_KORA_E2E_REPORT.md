# AP1 · Authenticated Kora E2E

Дата проверки: 18 июля 2026 года.

```text
AP1_SUPPORTED_SLICE_E2E=PASS
USERS=5
AUTH=magiclink
KORA_REGISTRY=209
AREA_M2=1800
PRODUCTION_CHANGED=false
```

Пройден disposable Supabase environment на PostgreSQL 17 с пятью реальными
локальными Auth-сессиями: owner, architect, builder, client и guest.

Проверены invitation accept, authenticated portfolio/read projection,
distribution и acknowledgement, exact replay, change request и impact review,
photo evidence и review, milestone acceptance, guest exact-token scope,
CSRF/origin guard, capability isolation и dashboard workspace.

Kora fixture: 209 registry records, 214 physical sources после foundation
fixtures, 85 materialized records, 129 placeholders, 1 site photo, 1 800 м².

В ходе gate исправлены два runtime-дефекта: стабильность public acknowledgement
replay-контракта и запрет distribution для не-owner ролей. Dashboard shell
теперь не требует service-role key в request-bound disposable runtime; production
режим сохраняет legacy studio membership check.

Production не читался и не изменялся.
