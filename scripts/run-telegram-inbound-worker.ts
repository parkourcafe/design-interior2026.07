// Системный воркер входящей очереди Telegram (A7 / DEC-031).
// Запуск: npm run worker:telegram-inbound
//
// Один проход: берёт входящие сообщения в аренду, просит модель
// классифицировать каждое и записывает НЕПОДТВЕРЖДЁННОГО кандидата Project
// Inbox. Ни одной доменной команды воркер не выполняет: ChangeRequest создаёт
// человек своей сессией после проверки.
//
// ЭТО НЕ ВКЛЮЧАЕТ МОСТ В PRODUCTION. A7 §9 не разрешает production-включение
// вовсе — до отдельного OWNER GO.
//
// Идентичность — только service role.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

import type { PostgresRpcClient } from "../lib/project-intelligence/adapters/postgres";
import { resolveTelegramBridgeConfig } from "../lib/integration-gateway/telegram/bridge-flag";
import { TelegramSystemPort } from "../lib/integration-gateway/telegram/gateway-port";
import { runTelegramInboundWorker } from "../lib/integration-gateway/telegram/inbound-runner";

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
    // Выключенный мост не классифицирует: ни чтения очереди, ни вызова модели.
    process.stdout.write(
      JSON.stringify({ channel: "telegram", event: "worker_noop", code: configured.reason }) + "\n",
    );
    return;
  }

  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const maxRows = Number(process.env.TELEGRAM_INBOUND_MAX_ROWS ?? "20");

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as PostgresRpcClient;

  const result = await runTelegramInboundWorker({
    port: new TelegramSystemPort(client),
    maxRows: Number.isFinite(maxRows) && maxRows > 0 ? maxRows : 20,
  });

  process.stdout.write(JSON.stringify({ channel: "telegram", event: "worker_run", ...result }) + "\n");
}

main().catch((error: unknown) => {
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
