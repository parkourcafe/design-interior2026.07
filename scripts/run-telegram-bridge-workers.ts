// Системные воркеры Telegram Chat Bridge (A7 / DEC-031, гейт TG3).
// Запуск: npm run bridge:telegram-workers
//
// Один проход по двум очередям:
//
//   1. проектор — выдачи M4, которых ещё нет в очереди уведомлений;
//   2. разборщик — канальные события, из которых ещё не сделаны кандидаты.
//
// Порядок именно такой: проектор ставит работу, разборщик разбирает входящее.
// Они независимы, и падение одного не отменяет другого.
//
// ЭТО НЕ ВКЛЮЧАЕТ МОСТ и не открывает M4. Воркеры ходят только в схему
// `remhaos_channel_api` под `service_role`; ни одной доменной команды они не
// зовут, ни одного официального объекта не создают. Кандидат остаётся
// кандидатом (A7 §1.6).

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

import type { PostgresRpcClient } from "../lib/project-intelligence/adapters/postgres";
import { TelegramSystemPort } from "../lib/integration-gateway/telegram/channel-port";
import { isTelegramBridgeEnabled } from "../lib/integration-gateway/telegram/bridge-flag";
import { runDistributionProjection } from "../lib/integration-gateway/telegram/distribution-projector";
import { runChannelExtractionBatch } from "../lib/integration-gateway/telegram/extraction/runner";

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
      `${JSON.stringify({ worker: "telegram-bridge", skipped: "bridge_disabled" })}\n`,
    );
    return;
  }

  const client = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  ) as unknown as PostgresRpcClient;

  const port = new TelegramSystemPort(client);
  const projection = await runDistributionProjection(port, {
    maxRows: Number(process.env.TELEGRAM_PROJECTION_MAX_ROWS ?? "50"),
  });
  const extraction = await runChannelExtractionBatch(port, {
    maxRows: Number(process.env.TELEGRAM_EXTRACTION_MAX_ROWS ?? "20"),
  });

  // Отчёт печатается всегда, в том числе на пустых очередях: «ничего не нашёл»
  // и «не запускался» обязаны различаться в логе.
  process.stdout.write(`${JSON.stringify({
    worker: "telegram-bridge",
    projection,
    extraction,
  })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      worker: "telegram-bridge",
      failed: error instanceof Error ? error.message : "unknown",
    })}\n`,
  );
  process.exitCode = 1;
});
