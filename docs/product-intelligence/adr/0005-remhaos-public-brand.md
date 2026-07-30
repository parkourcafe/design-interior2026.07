# ADR 0005: RemHaOS как публичный бренд

- Статус: принято владельцем
- Дата: 30.07.2026

## Решение

Публичное название российского продукта меняется с ArchiDom/ARHIDOM на
**RemHaOS**. Четыре рабочих пространства и единая модель проекта сохраняются.

`ProjectCEO` остаётся только internal compatibility namespace существующих
migrations, schemas/RPC, API routes и TypeScript contracts. Переименование
этих внутренних контрактов не входит в ребрендинг.

Канонический production hostname меняется на `www.remhaos.com`. iOS Bundle ID
`space.arhidom.ios` сохраняется как стабильный технический идентификатор:
публичное имя приложения не обязано совпадать с Bundle ID, а его смена после
загрузки build невозможна.

## Последствия

- UI, store metadata, installed display name и коммуникации используют RemHaOS.
- Universal Links используют `www.remhaos.com` и App ID
  `KB7VPWHTTM.space.arhidom.ios`.
- Старый домен должен перенаправлять на новый; AASA, support/privacy и `/app`
  проверяются непосредственно на новом каноническом hostname.
- Email поддержки меняется только после подтверждения нового принимающего ящика.
