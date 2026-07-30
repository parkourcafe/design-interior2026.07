# Measurement plan

## 1. Принципы

- События подтверждают использование workflow, а не vanity activity.
- Product analytics не является audit ledger.
- Event payload не содержит source text, client contacts, filenames или document URLs.
- `region`, `edition`, `organization_id`, `project_id`, `project_version_id` передаются как IDs/controlled dimensions.
- Время хранится UTC; отображение использует locale проекта.
- Метрики сравниваются по живому проекту и организации, а не только по пользователю.

## 2. Общий event dictionary

| Event | Когда пишется | Обязательные properties |
|---|---|---|
| `source_uploaded` | bytes приняты и checksum создан | source_kind, size_bucket |
| `source_processed` | ingestion завершён | status, duration_bucket, fragment_count |
| `claim_proposed` | создана AI/import revision | node_kind, claim_status |
| `claim_reviewed` | человек confirm/reject/edit | node_kind, outcome, review_seconds_bucket |
| `project_version_published` | версия immutable published | version_no, node_count |
| `decision_changed` | создана новая decision revision | reason_code, changed_field_count |
| `impact_calculated` | сохранён impact set | impacted_count, max_distance |
| `impact_reviewed` | человек завершил review | accepted, not_applicable, missing_added |
| `handoff_generated` | export готов | format, content_hash_prefix, unresolved_count |
| `handoff_used` | downstream use подтверждён | confirmation_method |
| `second_project_started` | organization начинает второй живой project | days_since_first |

`confirmation_method` — controlled value: `in_product`, `pilot_interview`, `integration_callback`; свободный текст не пишется.

## 3. ArchiDom Studio metrics

| Метрика | Формула |
|---|---|
| Time to approved scope | `scope_approved_at - first_source_uploaded_at` |
| Proposal preparation time | активное human time между first review и proposal ready |
| Pre-proposal omissions | confirmed risk/unknown nodes, закрытые до proposal |
| Scope revision count | число published versions до approved scope |
| AI confirmation rate | human_confirmed AI claims / reviewed AI claims |
| AI edit rate | edited AI claims / reviewed AI claims |
| Paid pilot conversion | subscriptions / completed paid pilots |
| Second-project rate | organizations with second project / completed pilot organizations |

AI confirmation rate не трактуется как качество без edit/reject и sampling false negatives.

## 4. ProUp Renovation metrics

| Метрика | Формула |
|---|---|
| Package review time | completeness review finish - first source upload |
| Pre-mobilization omissions | confirmed material gaps before crew start |
| Time to baseline | baseline published - package received |
| Change-order cycle time | approval - change initiated |
| Avoided rework | подтверждённые cases с оценённым avoided cost/time |
| Second-object rate | companies with second live object / completed pilot companies |

`Avoided rework` требует human evidence: описание риска, ожидаемая переделка, кто подтвердил и метод оценки. Автоматически рассчитанное предположение не считается.

## 5. Impact quality sample

Для каждого реального изменения пользователь размечает:

- `true_positive`: объект действительно требовал review;
- `false_positive`: объект не был затронут;
- `false_negative`: пользователь добавил пропущенный объект;
- `unverifiable`: недостаточно данных.

Расчёты:

```text
precision = TP / (TP + FP)
recall = TP / (TP + FN)
```

На малой выборке показывать сами counts рядом с долями. Не объявлять качество по одному изменению.

## 6. 30-day decision gate

Build-track выбирается не по сумме регистраций. Минимальный набор evidence:

- ≥3 оплаченных/контрактованных concierge pilots на треке;
- ≥2 реально использованных handoff;
- ≥2 организации назвали и начали второй проект;
- есть минимум 5 размеченных реальных changes;
- нет unresolved data-residency blocker;
- один повторяющийся workflow даёт измеримую экономию времени или предотвращённый риск.

Если оба трека проходят гейт, приоритет получает трек с большей долей второго проекта и меньшей стоимостью concierge delivery. Если ни один не проходит — не расширять P0.
