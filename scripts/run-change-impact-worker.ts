// Системный воркер расчёта влияния (DEC-033, V1 Impact, OWNER GO 12.08.2026).
// Запуск: npm run worker:change-impact
//
// Делает один проход по очереди: находит заявки на изменение, у которых ещё
// нет прогона влияния, и считает его через единственную policy-bound дверь.
// Без этого шага `review_change_impact` не имеет что рассматривать — расчёт
// не человеческая команда, его делает система.
//
// ЭТО НЕ ОТКРЫВАЕТ M4. Воркер не создаёт ни маршрута, ни команды, ни права:
// человеческая поверхность модуля закрыта флагом приложения и отозванными
// правами в базе, и запуск воркера этого не меняет. Он делает ровно ту работу,
// которую в продукте всегда делала система, а не человек.
//
// Идентичность — только service role: очередь, расчёт и запись durable-отказа
// выданы `service_role` и никому больше.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

import type { PostgresRpcClient } from "../lib/project-intelligence/adapters/postgres";
import { runChangeImpactWorker } from "../lib/project-intelligence/workers/change-impact/runner";

config({ path: ".env.local" });

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.includes("placeholder") || value.includes("your-")) {
    throw new Error(`Заполните ${name} реальным значением окружения.`);
  }
  return value;
}

async function main(): Promise<void> {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const maxRows = Number(process.env.CHANGE_IMPACT_WORKER_MAX_ROWS ?? "100");
  const maxAttemptsEnv = process.env.CHANGE_IMPACT_WORKER_MAX_ATTEMPTS;
  const maxAttempts = maxAttemptsEnv === undefined ? undefined : Number(maxAttemptsEnv);

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as PostgresRpcClient;

  const result = await runChangeImpactWorker({ client, maxRows, maxAttempts });

  // Отчёт печатается всегда, в том числе на пустой очереди: «ничего не нашёл»
  // и «не запускался» обязаны различаться в логе.
  process.stdout.write(`${JSON.stringify({
    worker: "change-impact",
    scanned: result.scanned,
    calculated: result.calculated,
    alreadyPresent: result.alreadyPresent,
    staleState: result.staleState,
    failureRecorded: result.failureRecorded,
    deadLettered: result.deadLettered,
    // Идентификаторы заявок и статусы покрытия — не PII; ни причин, ни
    // содержимого изменения здесь нет и быть не может.
    items: result.items,
  })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`change-impact worker failed: ${String(error)}\n`);
  process.exitCode = 1;
});
