# ARHIDOM RuStore QA Report

- Date: 2026-07-09T16:51:08.072738+00:00
- Base URL: `http://127.0.0.1:3000`
- Screenshots: `/Users/msnigmatullaeva/Documents/designinterior2026/repo/qa-artifacts/rustore-qa-2026-07-09/screenshots`
- Scope: local production Next.js server; authenticated designer cabinet requires real test credentials.

## Route Screenshots

| Viewport | Route | Status | Final URL | Screenshot | Console errors | Failed requests |
|---|---:|---:|---|---|---:|---:|
| desktop | `/` | 200 / PASS | `http://127.0.0.1:3000/` | `route__desktop__root.png` | 0 | 2 |
| desktop | `/designers` | 200 / PASS | `http://127.0.0.1:3000/designers` | `route__desktop__designers.png` | 0 | 0 |
| desktop | `/studios` | 200 / PASS | `http://127.0.0.1:3000/studios` | `route__desktop__studios.png` | 0 | 0 |
| desktop | `/security` | 200 / PASS | `http://127.0.0.1:3000/security` | `route__desktop__security.png` | 0 | 0 |
| desktop | `/pilot` | 200 / PASS | `http://127.0.0.1:3000/pilot` | `route__desktop__pilot.png` | 0 | 0 |
| desktop | `/demo` | 200 / PASS | `http://127.0.0.1:3000/demo` | `route__desktop__demo.png` | 0 | 0 |
| desktop | `/demo/brief` | 200 / PASS | `http://127.0.0.1:3000/demo/brief` | `route__desktop__demo_brief.png` | 0 | 0 |
| desktop | `/demo/proposal` | 200 / PASS | `http://127.0.0.1:3000/demo/proposal` | `route__desktop__demo_proposal.png` | 0 | 0 |
| desktop | `/legal/privacy` | 200 / PASS | `http://127.0.0.1:3000/legal/privacy` | `route__desktop__legal_privacy.png` | 0 | 0 |
| desktop | `/legal/terms` | 200 / PASS | `http://127.0.0.1:3000/legal/terms` | `route__desktop__legal_terms.png` | 0 | 0 |
| desktop | `/login` | 200 / PASS | `http://127.0.0.1:3000/login` | `route__desktop__login.png` | 0 | 0 |
| desktop | `/dashboard` | 500 / FAIL | `http://127.0.0.1:3000/dashboard` | `route__desktop__dashboard.png` | 1 | 0 |
| desktop | `/i/fake-token` | 500 / FAIL | `http://127.0.0.1:3000/i/fake-token` | `route__desktop__i_fake-token.png` | 1 | 1 |
| desktop | `/b/fake-token` | 500 / FAIL | `http://127.0.0.1:3000/b/fake-token` | `route__desktop__b_fake-token.png` | 1 | 1 |
| desktop | `/p/fake-token` | 500 / FAIL | `http://127.0.0.1:3000/p/fake-token` | `route__desktop__p_fake-token.png` | 1 | 1 |
| mobile | `/` | 200 / PASS | `http://127.0.0.1:3000/` | `route__mobile__root.png` | 0 | 2 |
| mobile | `/designers` | 200 / PASS | `http://127.0.0.1:3000/designers` | `route__mobile__designers.png` | 0 | 0 |
| mobile | `/studios` | 200 / PASS | `http://127.0.0.1:3000/studios` | `route__mobile__studios.png` | 0 | 0 |
| mobile | `/security` | 200 / PASS | `http://127.0.0.1:3000/security` | `route__mobile__security.png` | 0 | 0 |
| mobile | `/pilot` | 200 / PASS | `http://127.0.0.1:3000/pilot` | `route__mobile__pilot.png` | 0 | 0 |
| mobile | `/demo` | 200 / PASS | `http://127.0.0.1:3000/demo` | `route__mobile__demo.png` | 0 | 0 |
| mobile | `/demo/brief` | 200 / PASS | `http://127.0.0.1:3000/demo/brief` | `route__mobile__demo_brief.png` | 0 | 0 |
| mobile | `/demo/proposal` | 200 / PASS | `http://127.0.0.1:3000/demo/proposal` | `route__mobile__demo_proposal.png` | 0 | 0 |
| mobile | `/legal/privacy` | 200 / PASS | `http://127.0.0.1:3000/legal/privacy` | `route__mobile__legal_privacy.png` | 0 | 0 |
| mobile | `/legal/terms` | 200 / PASS | `http://127.0.0.1:3000/legal/terms` | `route__mobile__legal_terms.png` | 0 | 0 |
| mobile | `/login` | 200 / PASS | `http://127.0.0.1:3000/login` | `route__mobile__login.png` | 0 | 0 |
| mobile | `/dashboard` | 500 / FAIL | `http://127.0.0.1:3000/dashboard` | `route__mobile__dashboard.png` | 1 | 0 |
| mobile | `/i/fake-token` | 500 / FAIL | `http://127.0.0.1:3000/i/fake-token` | `route__mobile__i_fake-token.png` | 1 | 1 |
| mobile | `/b/fake-token` | 500 / FAIL | `http://127.0.0.1:3000/b/fake-token` | `route__mobile__b_fake-token.png` | 1 | 1 |
| mobile | `/p/fake-token` | 500 / FAIL | `http://127.0.0.1:3000/p/fake-token` | `route__mobile__p_fake-token.png` | 1 | 1 |

## Scenario Checks

| Scenario | Result | Evidence | Console errors | Failed requests |
|---|---:|---|---:|---:|
| `mobile_menu` | PASS | `scenario__mobile-menu.png` | 0 | 2 |
| `client_demo_brief` | PASS | `scenario__client-brief__01-intro.png`, `scenario__client-brief__02-first-question.png`, `scenario__client-brief__03-done.png` | 0 | 0 |
| `client_demo_proposal` | PASS | `scenario__client-proposal__01-initial.png`, `scenario__client-proposal__02-root.png`, `scenario__client-proposal__03-root.png`, `scenario__client-proposal__04-root.png` | 0 | 0 |
| `designer_auth_boundary` | FAIL | `scenario__designer__01-login.png`, `scenario__designer__02-dashboard-redirect.png` | 1 | 0 |

## Store / TWA Endpoints

| Endpoint | Status | Content-Type | Result |
|---|---:|---|---:|
| `/manifest.webmanifest` | 200 | `application/manifest+json` | PASS |
| `/.well-known/assetlinks.json` | 200 | `application/json` | PASS |
| `/icons/192` | 200 | `image/png` | PASS |
| `/icons/512` | 200 | `image/png` | PASS |
| `/api/health` | 200 | `application/json` | PASS |

## Transitions

| Source | Link | Target status | Final URL | Result |
|---|---|---:|---|---:|
| `/` | ARHIDOM БРИФ · ЦЕНА · КП → `/` | 200 | `http://127.0.0.1:3000/` | PASS |
| `/` | Для дизайнеров → `/designers` | 200 | `http://127.0.0.1:3000/designers` | PASS |
| `/` | Для студий → `/studios` | 200 | `http://127.0.0.1:3000/studios` | PASS |
| `/` | Как работает → `/#how` | 200 | `http://127.0.0.1:3000/#how` | PASS |
| `/` | Демо-бриф → `/demo/brief` | 200 | `http://127.0.0.1:3000/demo/brief` | PASS |
| `/` | Демо КП → `/demo/proposal` | 200 | `http://127.0.0.1:3000/demo/proposal` | PASS |
| `/` | Пилот → `/pilot` | 200 | `http://127.0.0.1:3000/pilot` | PASS |
| `/` | Безопасность → `/security` | 200 | `http://127.0.0.1:3000/security` | PASS |
| `/` | Контакты → `/pilot#request` | 200 | `http://127.0.0.1:3000/pilot#request` | PASS |
| `/` | Войти → `/login` | 200 | `http://127.0.0.1:3000/login` | PASS |
| `/` | Посмотреть паспорт → → `/demo` | 200 | `http://127.0.0.1:3000/demo` | PASS |
| `/` | Конфиденциальность → `/legal/privacy` | 200 | `http://127.0.0.1:3000/legal/privacy` | PASS |
| `/` | Условия → `/legal/terms` | 200 | `http://127.0.0.1:3000/legal/terms` | PASS |
| `/designers` | ARHIDOM БРИФ · ЦЕНА · КП → `/` | 200 | `http://127.0.0.1:3000/` | PASS |
| `/designers` | Для дизайнеров → `/designers` | 200 | `http://127.0.0.1:3000/designers` | PASS |
| `/designers` | Для студий → `/studios` | 200 | `http://127.0.0.1:3000/studios` | PASS |
| `/designers` | Как работает → `/#how` | 200 | `http://127.0.0.1:3000/#how` | PASS |
| `/designers` | Демо-бриф → `/demo/brief` | 200 | `http://127.0.0.1:3000/demo/brief` | PASS |
| `/designers` | Демо КП → `/demo/proposal` | 200 | `http://127.0.0.1:3000/demo/proposal` | PASS |
| `/designers` | Пилот → `/pilot` | 200 | `http://127.0.0.1:3000/pilot` | PASS |
| `/designers` | Безопасность → `/security` | 200 | `http://127.0.0.1:3000/security` | PASS |
| `/designers` | Контакты → `/pilot#request` | 200 | `http://127.0.0.1:3000/pilot#request` | PASS |
| `/designers` | Войти → `/login` | 200 | `http://127.0.0.1:3000/login` | PASS |
| `/designers` | Посмотреть Review Board → `/demo` | 200 | `http://127.0.0.1:3000/demo` | PASS |
| `/designers` | Конфиденциальность → `/legal/privacy` | 200 | `http://127.0.0.1:3000/legal/privacy` | PASS |
| `/designers` | Условия → `/legal/terms` | 200 | `http://127.0.0.1:3000/legal/terms` | PASS |
| `/studios` | ARHIDOM БРИФ · ЦЕНА · КП → `/` | 200 | `http://127.0.0.1:3000/` | PASS |
| `/studios` | Для дизайнеров → `/designers` | 200 | `http://127.0.0.1:3000/designers` | PASS |
| `/studios` | Для студий → `/studios` | 200 | `http://127.0.0.1:3000/studios` | PASS |
| `/studios` | Как работает → `/#how` | 200 | `http://127.0.0.1:3000/#how` | PASS |
| `/studios` | Демо-бриф → `/demo/brief` | 200 | `http://127.0.0.1:3000/demo/brief` | PASS |
| `/studios` | Демо КП → `/demo/proposal` | 200 | `http://127.0.0.1:3000/demo/proposal` | PASS |
| `/studios` | Пилот → `/pilot` | 200 | `http://127.0.0.1:3000/pilot` | PASS |
| `/studios` | Безопасность → `/security` | 200 | `http://127.0.0.1:3000/security` | PASS |
| `/studios` | Контакты → `/pilot#request` | 200 | `http://127.0.0.1:3000/pilot#request` | PASS |
| `/studios` | Войти → `/login` | 200 | `http://127.0.0.1:3000/login` | PASS |
| `/studios` | Посмотреть Review Board → `/demo` | 200 | `http://127.0.0.1:3000/demo` | PASS |
| `/studios` | Конфиденциальность → `/legal/privacy` | 200 | `http://127.0.0.1:3000/legal/privacy` | PASS |
| `/studios` | Условия → `/legal/terms` | 200 | `http://127.0.0.1:3000/legal/terms` | PASS |
| `/security` | ARHIDOM БРИФ · ЦЕНА · КП → `/` | 200 | `http://127.0.0.1:3000/` | PASS |
| `/security` | Для дизайнеров → `/designers` | 200 | `http://127.0.0.1:3000/designers` | PASS |
| `/security` | Для студий → `/studios` | 200 | `http://127.0.0.1:3000/studios` | PASS |
| `/security` | Как работает → `/#how` | 200 | `http://127.0.0.1:3000/#how` | PASS |
| `/security` | Демо-бриф → `/demo/brief` | 200 | `http://127.0.0.1:3000/demo/brief` | PASS |
| `/security` | Демо КП → `/demo/proposal` | 200 | `http://127.0.0.1:3000/demo/proposal` | PASS |
| `/security` | Пилот → `/pilot` | 200 | `http://127.0.0.1:3000/pilot` | PASS |
| `/security` | Безопасность → `/security` | 200 | `http://127.0.0.1:3000/security` | PASS |
| `/security` | Контакты → `/pilot#request` | 200 | `http://127.0.0.1:3000/pilot#request` | PASS |
| `/security` | Войти → `/login` | 200 | `http://127.0.0.1:3000/login` | PASS |
| `/security` | Конфиденциальность → `/legal/privacy` | 200 | `http://127.0.0.1:3000/legal/privacy` | PASS |
| `/security` | Условия → `/legal/terms` | 200 | `http://127.0.0.1:3000/legal/terms` | PASS |
| `/pilot` | ARHIDOM БРИФ · ЦЕНА · КП → `/` | 200 | `http://127.0.0.1:3000/` | PASS |
| `/pilot` | Для дизайнеров → `/designers` | 200 | `http://127.0.0.1:3000/designers` | PASS |
| `/pilot` | Для студий → `/studios` | 200 | `http://127.0.0.1:3000/studios` | PASS |
| `/pilot` | Как работает → `/#how` | 200 | `http://127.0.0.1:3000/#how` | PASS |
| `/pilot` | Демо-бриф → `/demo/brief` | 200 | `http://127.0.0.1:3000/demo/brief` | PASS |
| `/pilot` | Демо КП → `/demo/proposal` | 200 | `http://127.0.0.1:3000/demo/proposal` | PASS |
| `/pilot` | Пилот → `/pilot` | 200 | `http://127.0.0.1:3000/pilot` | PASS |
| `/pilot` | Безопасность → `/security` | 200 | `http://127.0.0.1:3000/security` | PASS |
| `/pilot` | Контакты → `/pilot#request` | 200 | `http://127.0.0.1:3000/pilot#request` | PASS |
| `/pilot` | Войти → `/login` | 200 | `http://127.0.0.1:3000/login` | PASS |
| `/pilot` | Конфиденциальность → `/legal/privacy` | 200 | `http://127.0.0.1:3000/legal/privacy` | PASS |
| `/pilot` | Условия → `/legal/terms` | 200 | `http://127.0.0.1:3000/legal/terms` | PASS |
| `/demo` | ARHIDOM БРИФ · ЦЕНА · КП → `/` | 200 | `http://127.0.0.1:3000/` | PASS |
| `/demo` | Для дизайнеров → `/designers` | 200 | `http://127.0.0.1:3000/designers` | PASS |
| `/demo` | Для студий → `/studios` | 200 | `http://127.0.0.1:3000/studios` | PASS |
| `/demo` | Как работает → `/#how` | 200 | `http://127.0.0.1:3000/#how` | PASS |
| `/demo` | Демо-бриф → `/demo/brief` | 200 | `http://127.0.0.1:3000/demo/brief` | PASS |
| `/demo` | Демо КП → `/demo/proposal` | 200 | `http://127.0.0.1:3000/demo/proposal` | PASS |
| `/demo` | Пилот → `/pilot` | 200 | `http://127.0.0.1:3000/pilot` | PASS |
| `/demo` | Безопасность → `/security` | 200 | `http://127.0.0.1:3000/security` | PASS |
| `/demo` | Контакты → `/pilot#request` | 200 | `http://127.0.0.1:3000/pilot#request` | PASS |
| `/demo` | Войти → `/login` | 200 | `http://127.0.0.1:3000/login` | PASS |
| `/demo` | Конфиденциальность → `/legal/privacy` | 200 | `http://127.0.0.1:3000/legal/privacy` | PASS |
| `/demo` | Условия → `/legal/terms` | 200 | `http://127.0.0.1:3000/legal/terms` | PASS |
| `/demo/brief` | ARHIDOM БРИФ · ЦЕНА · КП → `/` | 200 | `http://127.0.0.1:3000/` | PASS |
| `/demo/brief` | Для дизайнеров → `/designers` | 200 | `http://127.0.0.1:3000/designers` | PASS |
| `/demo/brief` | Для студий → `/studios` | 200 | `http://127.0.0.1:3000/studios` | PASS |
| `/demo/brief` | Как работает → `/#how` | 200 | `http://127.0.0.1:3000/#how` | PASS |
| `/demo/brief` | Демо-бриф → `/demo/brief` | 200 | `http://127.0.0.1:3000/demo/brief` | PASS |
| `/demo/brief` | Демо КП → `/demo/proposal` | 200 | `http://127.0.0.1:3000/demo/proposal` | PASS |
| `/demo/brief` | Пилот → `/pilot` | 200 | `http://127.0.0.1:3000/pilot` | PASS |
| `/demo/brief` | Безопасность → `/security` | 200 | `http://127.0.0.1:3000/security` | PASS |
| `/demo/brief` | Контакты → `/pilot#request` | 200 | `http://127.0.0.1:3000/pilot#request` | PASS |
| `/demo/brief` | Войти → `/login` | 200 | `http://127.0.0.1:3000/login` | PASS |
| `/demo/brief` | Конфиденциальность → `/legal/privacy` | 200 | `http://127.0.0.1:3000/legal/privacy` | PASS |
| `/demo/brief` | Условия → `/legal/terms` | 200 | `http://127.0.0.1:3000/legal/terms` | PASS |
| `/demo/proposal` | ARHIDOM БРИФ · ЦЕНА · КП → `/` | 200 | `http://127.0.0.1:3000/` | PASS |
| `/demo/proposal` | Для дизайнеров → `/designers` | 200 | `http://127.0.0.1:3000/designers` | PASS |
| `/demo/proposal` | Для студий → `/studios` | 200 | `http://127.0.0.1:3000/studios` | PASS |
| `/demo/proposal` | Как работает → `/#how` | 200 | `http://127.0.0.1:3000/#how` | PASS |
| `/demo/proposal` | Демо-бриф → `/demo/brief` | 200 | `http://127.0.0.1:3000/demo/brief` | PASS |
| `/demo/proposal` | Демо КП → `/demo/proposal` | 200 | `http://127.0.0.1:3000/demo/proposal` | PASS |
| `/demo/proposal` | Пилот → `/pilot` | 200 | `http://127.0.0.1:3000/pilot` | PASS |
| `/demo/proposal` | Безопасность → `/security` | 200 | `http://127.0.0.1:3000/security` | PASS |
| `/demo/proposal` | Контакты → `/pilot#request` | 200 | `http://127.0.0.1:3000/pilot#request` | PASS |
| `/demo/proposal` | Войти → `/login` | 200 | `http://127.0.0.1:3000/login` | PASS |
| `/demo/proposal` | Пресейл-контур за 2 минуты → `/demo` | 200 | `http://127.0.0.1:3000/demo` | PASS |
| `/demo/proposal` | Конфиденциальность → `/legal/privacy` | 200 | `http://127.0.0.1:3000/legal/privacy` | PASS |
| `/demo/proposal` | Условия → `/legal/terms` | 200 | `http://127.0.0.1:3000/legal/terms` | PASS |
| `/legal/privacy` | ARHIDOM БРИФ · ЦЕНА · КП → `/` | 200 | `http://127.0.0.1:3000/` | PASS |
| `/legal/privacy` | Для дизайнеров → `/designers` | 200 | `http://127.0.0.1:3000/designers` | PASS |
| `/legal/privacy` | Для студий → `/studios` | 200 | `http://127.0.0.1:3000/studios` | PASS |
| `/legal/privacy` | Как работает → `/#how` | 200 | `http://127.0.0.1:3000/#how` | PASS |
| `/legal/privacy` | Демо-бриф → `/demo/brief` | 200 | `http://127.0.0.1:3000/demo/brief` | PASS |
| `/legal/privacy` | Демо КП → `/demo/proposal` | 200 | `http://127.0.0.1:3000/demo/proposal` | PASS |
| `/legal/privacy` | Пилот → `/pilot` | 200 | `http://127.0.0.1:3000/pilot` | PASS |
| `/legal/privacy` | Безопасность → `/security` | 200 | `http://127.0.0.1:3000/security` | PASS |
| `/legal/privacy` | Контакты → `/pilot#request` | 200 | `http://127.0.0.1:3000/pilot#request` | PASS |
| `/legal/privacy` | Войти → `/login` | 200 | `http://127.0.0.1:3000/login` | PASS |
| `/legal/privacy` | Конфиденциальность → `/legal/privacy` | 200 | `http://127.0.0.1:3000/legal/privacy` | PASS |
| `/legal/privacy` | Условия → `/legal/terms` | 200 | `http://127.0.0.1:3000/legal/terms` | PASS |
| `/legal/terms` | ARHIDOM БРИФ · ЦЕНА · КП → `/` | 200 | `http://127.0.0.1:3000/` | PASS |
| `/legal/terms` | Для дизайнеров → `/designers` | 200 | `http://127.0.0.1:3000/designers` | PASS |
| `/legal/terms` | Для студий → `/studios` | 200 | `http://127.0.0.1:3000/studios` | PASS |
| `/legal/terms` | Как работает → `/#how` | 200 | `http://127.0.0.1:3000/#how` | PASS |
| `/legal/terms` | Демо-бриф → `/demo/brief` | 200 | `http://127.0.0.1:3000/demo/brief` | PASS |
| `/legal/terms` | Демо КП → `/demo/proposal` | 200 | `http://127.0.0.1:3000/demo/proposal` | PASS |
| `/legal/terms` | Пилот → `/pilot` | 200 | `http://127.0.0.1:3000/pilot` | PASS |
| `/legal/terms` | Безопасность → `/security` | 200 | `http://127.0.0.1:3000/security` | PASS |
| `/legal/terms` | Контакты → `/pilot#request` | 200 | `http://127.0.0.1:3000/pilot#request` | PASS |
| `/legal/terms` | Войти → `/login` | 200 | `http://127.0.0.1:3000/login` | PASS |
| `/legal/terms` | Конфиденциальность → `/legal/privacy` | 200 | `http://127.0.0.1:3000/legal/privacy` | PASS |
| `/legal/terms` | Условия → `/legal/terms` | 200 | `http://127.0.0.1:3000/legal/terms` | PASS |
| `explicit` | logo/home → `/` | 200 | `http://127.0.0.1:3000/` | PASS |
| `explicit` | nav designers → `/designers` | 200 | `http://127.0.0.1:3000/designers` | PASS |
| `explicit` | nav studios → `/studios` | 200 | `http://127.0.0.1:3000/studios` | PASS |
| `explicit` | nav how → `/#how` | 200 | `http://127.0.0.1:3000/#how` | PASS |
| `explicit` | nav demo brief → `/demo/brief` | 200 | `http://127.0.0.1:3000/demo/brief` | PASS |
| `explicit` | nav demo proposal → `/demo/proposal` | 200 | `http://127.0.0.1:3000/demo/proposal` | PASS |
| `explicit` | nav pilot → `/pilot` | 200 | `http://127.0.0.1:3000/pilot` | PASS |
| `explicit` | nav security → `/security` | 200 | `http://127.0.0.1:3000/security` | PASS |
| `explicit` | nav contacts → `/pilot#request` | 200 | `http://127.0.0.1:3000/pilot#request` | PASS |
| `explicit` | nav login → `/login` | 200 | `http://127.0.0.1:3000/login` | PASS |
| `explicit` | protected dashboard → `/dashboard` | 500 | `http://127.0.0.1:3000/dashboard` | FAIL |

## Local Speed

Threshold: load duration ≤ 2500 ms and DOMContentLoaded ≤ 1500 ms on local production server, with no console errors or failed requests.

| Route | Status | Duration | DCL | TTFB | Transfer | Resources | Result |
|---|---:|---:|---:|---:|---:|---:|---:|
| `/` | 200 | 646 ms | 179 ms | 3 ms | 299 KB | 53 | FAIL |
| `/designers` | 200 | 352 ms | 146 ms | 1 ms | 319 KB | 53 | PASS |
| `/studios` | 200 | 334 ms | 143 ms | 1 ms | 322 KB | 53 | PASS |
| `/security` | 200 | 348 ms | 144 ms | 2 ms | 288 KB | 51 | PASS |
| `/pilot` | 200 | 332 ms | 147 ms | 1 ms | 278 KB | 50 | PASS |
| `/demo/brief` | 200 | 402 ms | 140 ms | 1 ms | 289 KB | 59 | PASS |
| `/demo/proposal` | 200 | 334 ms | 139 ms | 1 ms | 278 KB | 50 | PASS |
| `/login` | 200 | 323 ms | 136 ms | 1 ms | 183 KB | 13 | PASS |

## Issues

- `routes` `/dashboard`: failed check
- `routes` `/i/fake-token`: failed check
- `routes` `/b/fake-token`: failed check
- `routes` `/p/fake-token`: failed check
- `routes` `/dashboard`: failed check
- `routes` `/i/fake-token`: failed check
- `routes` `/b/fake-token`: failed check
- `routes` `/p/fake-token`: failed check
- `scenarios` `designer_auth_boundary`: failed check
- `transitions` `/dashboard`: failed check
- `speed` `/`: failed check
