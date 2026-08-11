/**
 * Флаг Telegram Chat Bridge — A7 / DEC-031 (подписан 11.08.2026).
 *
 * Выключен по умолчанию: отсутствие переменной означает «закрыто», а не
 * «неизвестно». Флаг серверный — в браузер он не передаётся, иначе его можно
 * было бы обойти из клиента.
 *
 * ВАЖНО ПРО ГРАНИЦЫ, и урок здесь чужой — его дали guardrail'ы модулей 3 и 4.
 * Этот флаг закрывает ОДНУ границу из двух — приложение. Вторая граница — база:
 * схема `projectceo_gateway_api` отдана Data API (`supabase/config.toml`), и
 * вызов через PostgREST до TypeScript не доходит вовсе. Поэтому человеческие
 * RPC шлюза отозваны у `authenticated` миграцией `20260811050000`, а среда, где
 * мост намеренно открыт, возвращает их явно
 * (`tests/ap1/environment/enable-telegram-bridge.sql`). Один флаг без этого
 * описывал бы запрет, а не создавал его.
 *
 * ЧТО ЗНАЧИТ «ВЫКЛЮЧЕН». Выключенный мост не принимает, не классифицирует и не
 * отправляет сообщения. Проверка обязана стоять ДО любых бизнес-чтений: no-op
 * или контролируемый отказ, а не «прочитали проект, потом передумали».
 *
 * PRODUCTION. A7 §9 не разрешает production-включение вовсе — до закрытия
 * legal / data-plane / consent / retention гейта. Значение `true` в рабочем
 * окружении требует отдельного OWNER GO.
 */

export function isTelegramBridgeEnabled(
  value = process.env.REMHAOS_TELEGRAM_BRIDGE_ENABLED,
): boolean {
  return value === "true";
}

/**
 * Конфигурация транспорта. Читается ТОЛЬКО на сервере и ТОЛЬКО из окружения:
 * токен бота и секрет вебхука в базу не попадают и в логи не пишутся.
 *
 * `botInstanceId` — логическое имя экземпляра, оно же уходит в базу. Это не
 * токен и не его часть: по нему нельзя ни отправить сообщение, ни скачать файл.
 */
export interface TelegramBridgeConfig {
  readonly botToken: string;
  readonly botUsername: string;
  readonly botInstanceId: string;
  readonly webhookSecret: string;
}

export type TelegramBridgeConfigResult =
  | { readonly ok: true; readonly config: TelegramBridgeConfig }
  /**
   * `disabled` — моста нет по решению. `misconfigured` — мост включили, но
   * секретов нет. Разные причины намеренно не сливаются: первая нормальна,
   * вторая означает поломку развёртывания и обязана быть видна.
   */
  | { readonly ok: false; readonly reason: "disabled" | "misconfigured" };

/**
 * Читается ровно то, что нужно, и типом ровно того, что нужно: `NodeJS.ProcessEnv`
 * требует `NODE_ENV`, и тесту пришлось бы подделывать целое окружение ради
 * четырёх переменных.
 */
export type TelegramBridgeEnv = Readonly<Record<string, string | undefined>>;

function readEnv(env: TelegramBridgeEnv, name: string): string | null {
  const value = env[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function resolveTelegramBridgeConfig(
  env: TelegramBridgeEnv = process.env,
): TelegramBridgeConfigResult {
  if (!isTelegramBridgeEnabled(env.REMHAOS_TELEGRAM_BRIDGE_ENABLED)) {
    return { ok: false, reason: "disabled" };
  }
  const botToken = readEnv(env, "TELEGRAM_TEST_BOT_TOKEN");
  const botUsername = readEnv(env, "TELEGRAM_TEST_BOT_USERNAME");
  const webhookSecret = readEnv(env, "TELEGRAM_TEST_WEBHOOK_SECRET");
  if (!botToken || !botUsername || !webhookSecret) {
    return { ok: false, reason: "misconfigured" };
  }
  // Секрет вебхука короче 32 байт не защищает ничего: Telegram шлёт его
  // открытым заголовком, и всё, что стоит между ним и злоумышленником, — длина.
  if (new TextEncoder().encode(webhookSecret).byteLength < 32) {
    return { ok: false, reason: "misconfigured" };
  }
  return {
    ok: true,
    config: {
      botToken,
      botUsername,
      // Логическое имя выводится из username, а НЕ из токена: значение уходит в
      // базу, и производное от секрета там появиться не может.
      botInstanceId: `telegram:${botUsername.toLowerCase()}`,
      webhookSecret,
    },
  };
}
