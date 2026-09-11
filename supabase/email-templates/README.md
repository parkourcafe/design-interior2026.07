# Письма входа (Supabase) — как настроить

Два готовых шаблона в этой папке:
- `magic_link.html` — письмо со ссылкой/кодом для входа.
- `confirm_signup.html` — письмо подтверждения при первой регистрации.

Оба показывают **6-значный код** `{{ .Token }}` крупно + кнопку-ссылку `{{ .ConfirmationURL }}`.
Логин уже умеет и то, и другое: можно кликнуть ссылку **или** ввести код на странице входа.

## Часть А — вставить шаблоны (2 минуты, нужно для демо)

1. Supabase → production-проект **RemHaOS** → **Authentication** → **Emails** → **Templates**.
2. Открыть **Magic Link** → в поле письма вставить содержимое `magic_link.html`. Subject: `Вход в RemHaOS — ваш код`.
3. Открыть **Confirm signup** → вставить содержимое `confirm_signup.html`. Subject: `Подтвердите вход в RemHaOS`.
4. Сохранить. Отправить себе тестовое письмо (попробовать войти) — проверить, что код и кнопка на месте.

Больше для демо ничего не нужно: встроенной почты Supabase хватает.

## Часть Б — свой SMTP через Resend (для боевой рассылки клиентам)

**Конфигурация проекта:** домен `remhaos.com` (DNS настраивается у текущего
регистратора домена).
Отправитель: `noreply@remhaos.com`, имя `RemHaOS`.

### Шаг 1. Resend: добавить домен
1. **resend.com** → Sign up (можно через Google).
2. Слева **Domains** → **Add Domain** → ввести `remhaos.com` → Add.
3. Resend покажет **3 DNS-записи** (MX/TXT — SPF, TXT — DKIM, TXT — DMARC). Не закрывать эту страницу.

### Шаг 2. Vercel: добавить эти 3 записи в DNS
1. У текущего регистратора домена открыть DNS-записи для **remhaos.com**.
2. Для каждой записи из Resend нажать **Add** и перенести Type / Name / Value.
   - ⚠️ В поле **Name** вписывать только префикс без домена: Resend показывает `send.remhaos.com` → в DNS ввести `send`; `resend._domainkey.remhaos.com` → `resend._domainkey`; `_dmarc.remhaos.com` → `_dmarc`. Для корня — оставить `@`.
   - Значение (Value) копировать целиком, особенно длинный DKIM (`p=...`).
3. Сохранить каждую.

### Шаг 3. Resend: подтвердить
- Вернуться в Resend → на странице домена нажать **Verify DNS Records**. Через несколько минут (иногда до часа) статус станет **Verified**.

### Шаг 4. Resend: создать ключ
- Resend → **API Keys** → **Create API Key** → скопировать `re_…` (показывается один раз).

### Шаг 5. Supabase: включить Custom SMTP
Supabase → production-проект **RemHaOS** → **Project Settings** → **Authentication** → **SMTP Settings** → Enable Custom SMTP:
- Host: `smtp.resend.com`
- Port: `465`
- Username: `resend`
- Password: ключ `re_…`
- Sender email: `noreply@remhaos.com`
- Sender name: `RemHaOS`
- Сохранить → отправить себе тестовое письмо (попробовать войти).
