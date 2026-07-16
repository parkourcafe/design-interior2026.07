# RU input package: Restaurant Second Floor

Оригинал: `DWG - Restaurant Second Floor.rar`
SHA-256: `51eaff109223e3dd28d0efd2134d6a778844d8377eeb94941e806fee37d04a66`

Состав после read-only распаковки:

- 24 `.dwg` чертежа;
- 34 `.bak` резервных файла;
- 1 `.xlsx` drawing list;
- AutoCAD DWG 2007/2008/2009 и 2018/2019/2020 форматы.

## Импортная политика

- `.dwg` — исходные design-package sources;
- `.xlsx` — индекс листов и deliverable baseline;
- `.bak` — не импортируются автоматически, используются только для ручного восстановления;
- геометрия DWG пока не интерпретируется: на этом этапе сохраняются provenance,
  листы, версии и связи с baseline.

Следующий шаг — сопоставить drawing list с canonical sheets и построить RU baseline/WBS.
