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
// Идентичности две и не смешиваются (DEC-045 (b)):
//   * очередь вложений и загрузка байтов в карантинное хранилище —
//     `service_role` (системные двери моста, Storage);
//   * записи file intake (`create_file_intake_worker` /
//     `mark_file_intake_uploaded_worker`) — узкая роль `pi_telegram_file_worker` по ключу
//     `REMHAOS_FILE_INTAKE_WORKER_JWT`. Ключ выпускает владелец:
//     docs/canonical/remhaos-v1/REMHAOS_FILE_INTAKE_WORKER_KEY_RUNBOOK.md. Без него — отказ до
//     первого захвата, попытки не тратятся.

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
import { createFileIntakeWorkerClient } from "../lib/integration-gateway/runtime/worker-client";

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

  // Ключ воркера проверяется ДО захвата: иначе вложения брались бы в аренду
  // процессом, который заведомо не может их положить в карантин.
  const workerClient = createFileIntakeWorkerClient();

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
    new FileIntakeWorkerService(workerClient, admin.storage as unknown as PrivateStorageClient),
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
