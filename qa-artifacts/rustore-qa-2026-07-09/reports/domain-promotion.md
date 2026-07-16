# Domain Promotion Log

Дата: 2026-07-10 локально / 2026-07-09 UTC.

## Что сделано

Preview deployment:

- `https://design-interior2026-07-git-claude-new-session-gsayp3-yulaboober.vercel.app/`
- deployment id: `dpl_J1nnir6DXaiQpzrWiu2qfx5rd83b`

Промоутнут на production через Vercel CLI.

Новый production deployment:

- `https://design-interior2026-07-qnihtrcyj-yulaboober.vercel.app`
- deployment id: `dpl_FJNahuPjMm9LtrNLKGM1t8Sr4pgH`
- status: Ready

Production aliases после переключения:

- `https://www.arhidom.space`
- `https://arhidom.space`
- `https://design-interior2026-07.vercel.app`
- `https://design-interior2026-07-yulaboober.vercel.app`
- `https://design-interior2026-07-git-claude-new-session-gsayp3-yulaboober.vercel.app`

## Проверка После Переключения

- `https://www.arhidom.space/`: 200, ARHIDOM version, TTFB ~0.138s.
- `https://www.arhidom.space/demo/brief`: 200, TTFB ~0.131s.
- `https://www.arhidom.space/demo/proposal`: 200, TTFB ~0.145s.
- `https://www.arhidom.space/manifest.webmanifest`: 200, новый ARHIDOM manifest.
- `https://www.arhidom.space/api/health`: 200, Supabase и LLM env настроены.
- `https://arhidom.space/`: 308 redirect на `https://www.arhidom.space/`.

## Осталось Для RuStore

`https://www.arhidom.space/.well-known/assetlinks.json` теперь обслуживается route-ом, но возвращает `[]`.

Причина: в production env ещё не заданы реальные:

- `ANDROID_PACKAGE_NAME`
- `ANDROID_CERT_SHA256`

Для RuStore нельзя ставить тестовый fingerprint. Нужен SHA-256 сертификата, которым будет подписан AAB/APK для RuStore.
