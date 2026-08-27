# AP6 External Package — Tashkent Courtyard House

Статус: **операторская подготовка для disposable AP1; не production evidence**
Дата: 27.08.2026
Контур: M1 enrollment → Project Intelligence → M2 selection/review → M3 handoff

## 1. Идентичность пакета

Внешний пакет собран из переданного набора проектных PDF для объекта в Ташкенте,
Узбекистан. В манифесте зафиксированы организация, проект, package и выбранная
область: первый этаж, кухня и гостиная. Полный объектный контекст составляет
340 м²: первый этаж 204.5 м², подвал с котельной 7.5 м², второй этаж 128 м².

| Файл | Что извлечено | SHA-256 |
|---|---|---|
| `facade.pdf` | фасад по осям 1–4, отметки от -2.200 до +10.000 | `397190df1a8d96053dc7e4fb7f9952a36a522e4c9356cd71d3312fb599594ced` |
| `Sections B-B, 3-3.pdf` | разрезы и размеры 600/3200/400/2200/1000/800/2000 | `29b7e87969ab6335856e443d381cb1906647fbfd1230caabba33615e744074bf` |
| `01.pdf` | первый этаж; кухня 11.7 м², гостиная 39.9 м² | `a5e08b87485c34978f3305909d0d8198cf867e7fb7981926ff965c3057d65c91` |
| `-1.pdf` | подвал; котельная 7.5 м² | `5ef216af32df8cc884e128fde063d08427d3c15e467f3aa7a9d479c8e17175d0` |
| `02.pdf` | второй этаж; жилые комнаты, холл и санузел | `996122d03cf41c8ad73e02316bb8d6df4c0d79bf7f7e784a1d6f1a049911fb5e` |

Каждый source в манифесте содержит внешний reference, checksum, страницу,
лист, fragment ID, verbatim/extracted/interpreted provenance и явное поле
непроверенного. Structural adequacy, latest issue, scale fidelity, local code
compliance и engineering coordination этим прогоном не утверждаются.

## 2. Выбранная область и варианты

Одна область намеренно ограничена kitchen/living ground-floor scope. Это не
утверждение полного проектирования всего дома. Оператор подготовил три
различимых варианта, каждый с отдельным layout document/version/revision:

| Вариант | Роль | Отличие в layout | Ценовая модель |
|---|---|---|---|
| `tashkent-preferred` | preferred | пролёт 6200 мм, дверь 900×2200 мм | 128 044 RUB normalized total |
| `tashkent-value` | value engineered | пролёт 5800 мм, дверь 800×2100 мм | 128 044 RUB normalized total |
| `tashkent-premium` | premium | пролёт 6800 мм, дверь 1000×2300 мм | 128 044 RUB normalized total |

Это operator-prepared варианты для проверки трассировки и human review. Они не
являются автоматически сгенерированной концепцией и не заменяют рабочую
документацию.

## 3. Цены и нормализация

Исходные наблюдения подготовлены в UZS, затем явно нормализованы в RUB по
зафиксированному входу `1 UZS = 0.0068 RUB`:

`amountRub = round(amountUzs × 0.0068)`

| Наблюдение | UZS | RUB после нормализации |
|---|---:|---:|
| напольное покрытие | 185 000 | 1 258 |
| стеновая отделка | 145 000 | 986 |
| фасады и корпус кухни | 18 500 000 | 125 800 |
| монтажная позиция A | 2 100 000 | 14 280 |
| монтажная позиция B | 2 650 000 | 18 020 |
| монтажная позиция C | 3 900 000 | 26 520 |
| монтажная позиция D | 4 800 000 | 32 640 |
| монтажная позиция E | 3 200 000 | 21 760 |
| монтажная позиция F | 7 600 000 | 51 680 |

Price observations имеют provenance `operator worksheet`, supplier reference
не является подтверждением текущего коммерческого предложения. Курс и цены
нужно подтвердить у поставщика до любого коммерческого решения. AP6 проверяет
не рыночную истинность этих сумм, а отсутствие скрытой валюты и сохранение
происхождения UZS → RUB → selection budget.

## 4. Доказательная цепочка

В disposable прогоне ожидается следующая цепочка без ручной записи в private
таблицы:

`PDF source → source graph revision → published project graph → interpreted decision → selection revision → UZS price observation/RUB normalization → approval package → client review → selected layout version → M2 approved commit → M3 handoff`

Человеческие действия выполняются authenticated role sessions. Service role
используется только для разрешённых disposable fixture/setup операций; production
Supabase не участвует. Повтор каждой HTTP-команды должен быть replay без второй
мутации, а итоговый receipt обязан содержать реальные DB command/audit IDs.

## 5. Ограничения статуса

До успешного `EXTERNAL_REAL_PACKAGE_PASS` AP6 остаётся `pending`. Настоящий
пакет не является production adoption, не открывает M4 production и не доказывает
актуальность цен, инженерную пригодность, строительную реализуемость или
соответствие нормам Узбекистана.
