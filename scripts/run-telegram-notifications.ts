// Отправитель очереди уведомлений Telegram (A7 / DEC-031, гейт TG2).
// Запуск: npm run bridge:telegram-notifications
//
// Делает один проход по очереди: забирает готовые к отправке уведомления,
// отправляет их в подключённые чаты и отмечает результат. Лиза, а не удаление:
// упавший на середине прогон не уносит работу — следующий подберёт её, когда
// лиза истечёт.
//
// ЭТО НЕ ВКЛЮЧАЕТ МОСТ. Запуск отправителя не открывает ни приёма сообщений,
// ни маршрута webhook: они закрыты флагом приложения и правами в базе. Без
// `REMHAOS_TELEGRAM_BRIDGE_ENABLED=true` отправитель отказывается работать —
// иначе он был бы обходом флага, а не его частью.
//
// Идентичность — только service role: очередь выдана `service_role` и никому
// больше. Токен бота читается из окружения и не попадает ни в базу, ни в лог.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

import type { PostgresRpcClient } from "../lib/project-intelligence/adapters/postgres";
import { TelegramBotApi } from "../lib/integration-gateway/telegram/bot-api";
import { TelegramSystemPort } from "../lib/integration-gateway/telegram/channel-port";
import { isTelegramBridgeEnabled } from "../lib/integration-gateway/telegram/bridge-flag";
import { readTelegramCredentials } from "../lib/integration-gateway/telegram/config";
import { runTelegramNotificationBatch } from "../lib/integration-gateway/telegram/notification-runner";

config({ path: ".env.local" });

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.includes("placeholder") || value.includes("your-")) {
    throw new Error(`Заполните ${name} реальным значением окружения.`);
  }
  return value;
}

async function main(): Promise<void> {
  if (!isTelegramBridgeEnabled()) {
    process.stdout.write(
      `${JSON.stringify({ worker: "telegram-notifications", skipped: "bridge_disabled" })}\n`,
    );
    return;
  }

  const credentials = readTelegramCredentials();
  if (!credentials.ok) {
    // Имена переменных назвать можно и нужно — иначе непонятно, чего не хватает.
    // Значения — никогда.
    throw new Error(`Не заданы переменные: ${credentials.missing.join(", ")}`);
  }

  const client = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  ) as unknown as PostgresRpcClient;

  const result = await runTelegramNotificationBatch(
    new TelegramSystemPort(client),
    new TelegramBotApi(credentials.credentials.botToken),
    {
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      maxRows: Number(process.env.TELEGRAM_NOTIFICATION_MAX_ROWS ?? "20"),
    },
  );

  // Отчёт печатается всегда, в том числе на пустой очереди: «ничего не нашёл»
  // и «не запускался» обязаны различаться в логе.
  process.stdout.write(`${JSON.stringify({
    worker: "telegram-notifications",
    claimed: result.claimed,
    sent: result.sent,
    failed: result.failed,
    skipped: result.skipped,
  })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      worker: "telegram-notifications",
      failed: error instanceof Error ? error.message : "unknown",
    })}\n`,
  );
  process.exitCode = 1;
});
