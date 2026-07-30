# RU ProUp Renovation — vertical-slice seams

Статус: pure-domain skeleton, без production и без адаптеров хранения.

Добавлены проверяемые контракты для импорта дизайн-пакета с SHA-256 provenance,
baseline, детерминированного WBS, сметы в целых рублях, последовательности закупки,
change order, фотоотчёта и handover. Реальный PDF/DWG/XLSX parser, Supabase Storage,
Telegram transport и RPC adapter остаются следующим интеграционным слоем.

Проверка: `npx vitest run lib/project-intelligence/ru-vertical-slice.test.ts`.

## Integration design review

Bounded review текущих domain seams против 31 DB2 relations, шести RPC и private
Storage зафиксировал, что accepted L1 mutations готовы, но onboarding, ingestion,
read model, WBS/procurement persistence, photo acceptance и construction handover
отсутствуют. Прямой table/service-role обход запрещён.

- [DB2 / Storage adapter specification](./DB2_STORAGE_ADAPTER_SPEC.md)
- [Integration gap register](./INTEGRATION_GAP_REGISTER.md)
- [Adapter acceptance test plan](./ADAPTER_ACCEPTANCE_TEST_PLAN.md)
