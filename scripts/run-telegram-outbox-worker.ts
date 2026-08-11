// Системный воркер исходящих уведомлений Telegram (A7 / DEC-031).
// Запуск: npm run worker:telegram-outbox
//
// Делает один проход: сначала догоняющий проектор превращает выдачи выпуска без
// уведомления в строки outbox, затем очередь берётся в аренду и отправляется.
//
// ЭТО НЕ ВКЛЮЧАЕТ МОСТ В PRODUCTION. Воркер не создаёт ни маршрута, ни команды,
// ни права: человеческая поверхность закрыта флагом приложения и отозванными
// правами в базе, и запуск воркера этого не меняет. A7 §9 не разрешает
// production-включение вовсе — до отдельного OWNER GO.
//
// Идентичность — только service role: и проектор, и очередь выданы
// `service_role` и никому больше.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

import type { PostgresRpcClient } from "../lib/project-intelligence/adapters/postgres";
import { resolveTelegramBridgeConfig } from "../lib/integration-gateway/telegram/bridge-flag";
import { TelegramSystemPort } from "../lib/integration-gateway/telegram/gateway-port";
import { TelegramApi } from "../lib/integration-gateway/telegram/telegram-api";
import { runTelegramNotificationWorker } from "../lib/integration-gateway/telegram/notification-runner";
import { releaseNotificationTemplate } from "../lib/integration-gateway/telegram/release-notification";

config({ path: ".env.local" });

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.includes("placeholder") || value.includes("your-")) {
    throw new Error(`Заполните ${name} реальным значением окружения.`);
  }
  return value;
}

async function main(): Promise<void> {
  const configured = resolveTelegramBridgeConfig();
  if (!configured.ok) {
    // Выключенный мост — не ошибка запуска, а решение. Воркер завершается
    // успешно и НИЧЕГО не делает: ни чтения очереди, ни отправки.
    process.stdout.write(
      JSON.stringify({ channel: "telegram", event: "worker_noop", code: configured.reason }) + "\n",
    );
    return;
  }

  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const maxRows = Number(process.env.TELEGRAM_OUTBOX_MAX_ROWS ?? "20");

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as PostgresRpcClient;

  const result = await runTelegramNotificationWorker({
    port: new TelegramSystemPort(client),
    api: new TelegramApi({ botToken: configured.config.botToken }),
    template: releaseNotificationTemplate(process.env.NEXT_PUBLIC_APP_URL ?? ""),
    maxRows: Number.isFinite(maxRows) && maxRows > 0 ? maxRows : 20,
  });

  process.stdout.write(JSON.stringify({ channel: "telegram", event: "worker_run", ...result }) + "\n");
}

main().catch((error: unknown) => {
  // Наружу — код, не сообщение: в чужом сбое бывает URL с токеном бота.
  const code = (error as { code?: unknown } | null)?.code;
  process.stderr.write(
    JSON.stringify({
      channel: "telegram",
      event: "worker_failed",
      code: typeof code === "string" ? code : "unknown_failure",
    }) + "\n",
  );
  process.exitCode = 1;
});
