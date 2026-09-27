// Фоновая загрузка вложений Telegram (DEC-044 (b), TG2).
// Запуск: npm run bridge:telegram-attachments
//
// Один проход: берёт в аренду вложения проектов с включённым флагом «файлы»,
// скачивает их из Telegram с лимитом размера, кладёт в карантин file intake
// (`scan_pending`) и сообщает итог базе. Дальше — обычная проверка файла.
//
// Два выключателя, оба обязательны:
//   * `REMHAOS_TELEGRAM_BRIDGE_ENABLED=true` — глобальный флаг моста;
//   * `REMHAOS_TELEGRAM_ATTACHMENTS_ENABLED=true` — глобальный флаг загрузки.
// Флаг проекта «файлы» проверяет база: чужие вложения процесс не получает.
//
// Идентичность — ОТКРЫТЫЙ ВОПРОС (см. evidence TG2):
//   * очередь вложений — `service_role` (системные двери моста);
//   * карантин file intake — функции `create_file_intake_worker` /
//     `mark_file_intake_uploaded_worker` выданы только `pi_worker_executor`,
//     а логин-роли с этим членством ни в одном окружении нет (как и для импорта
//     Google Drive). Через `service_role` вызов будет отклонён правами базы, и
//     проход остановится с ошибкой. Поэтому `REMHAOS_TELEGRAM_ATTACHMENTS_ENABLED`
//     не включается, пока владелец не решит, под какой ролью работает воркер.
//     Путь целиком доказан в DB4 (`85_telegram_tg2.sql`, SET ROLE
//     pi_worker_executor) и unit-тестами с фейковым Telegram.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

import type { PostgresRpcClient } from "../lib/project-intelligence/adapters/postgres";
import type { PrivateStorageClient } from "../lib/project-intelligence/adapters/storage";
import { TelegramBotApi } from "../lib/integration-gateway/telegram/bot-api";
import { TelegramSystemPort } from "../lib/integration-gateway/telegram/channel-port";
import { isTelegramBridgeEnabled } from "../lib/integration-gateway/telegram/bridge-flag";
import { readTelegramCredentials } from "../lib/integration-gateway/telegram/config";
import { runTelegramAttachmentBatch } from "../lib/integration-gateway/telegram/attachment-runner";
import { FileIntakeWorkerService } from "../lib/integration-gateway/file-intake/service";

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
    process.stdout.write(`${JSON.stringify({ worker: "telegram-attachments", skipped: "bridge_disabled" })}\n`);
    return;
  }
  if (process.env.REMHAOS_TELEGRAM_ATTACHMENTS_ENABLED !== "true") {
    process.stdout.write(`${JSON.stringify({ worker: "telegram-attachments", skipped: "attachments_disabled" })}\n`);
    return;
  }

  const credentials = readTelegramCredentials();
  if (!credentials.ok) {
    throw new Error(`Не заданы переменные: ${credentials.missing.join(", ")}`);
  }

  const admin = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const client = admin as unknown as PostgresRpcClient;

  const result = await runTelegramAttachmentBatch(
    new TelegramSystemPort(client),
    new TelegramBotApi(credentials.credentials.botToken),
    new FileIntakeWorkerService(client, admin.storage as unknown as PrivateStorageClient),
    {
      maxRows: Number(process.env.TELEGRAM_ATTACHMENT_MAX_ROWS ?? "5"),
    },
  );

  process.stdout.write(`${JSON.stringify({ worker: "telegram-attachments", ...result })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      worker: "telegram-attachments",
      failed: error instanceof Error ? error.message : "unknown",
    })}\n`,
  );
  process.exitCode = 1;
});
