// Системный воркер расчёта влияния (V1 Impact, W1).
// Запуск: npm run worker:change-impact
//
// Делает один проход по очереди: находит заявки на изменение, у которых ещё нет
// прогона влияния, и считает его. Без этого шага `review_change_impact`
// упирается в отсутствующий `impactRunId`: команда ждёт прогон, а человеческой
// двери к расчёту нет и не будет.
//
// ЭТО НЕ ОТКРЫВАЕТ M4. Воркер не создаёт ни маршрута, ни команды, ни права:
// человеческая поверхность модуля закрыта флагом приложения и отозванными
// правами в базе, и запуск воркера этого не меняет. Он делает ровно ту работу,
// которую в продукте всегда делала система, а не человек.
//
// Идентичность — только service role: обе RPC (очередь и расчёт) выданы
// `service_role` и никому больше.
//
// КОД ВОЗВРАТА. Ненулевой, если проход оставил работу человеку: частичный
// прогон (его нельзя закрыть без подтверждения архитектора) или неразрешимый
// baseline. Следующий проход этого не доберёт — нужен человек. Гонка
// (`stale_state`) и «уже готово» кодом возврата не считаются: это нормальные
// исходы, и следующий проход их доберёт сам.

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
  const maxRows = Number(process.env.IMPACT_WORKER_MAX_ROWS ?? "100");

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as PostgresRpcClient;

  const result = await runChangeImpactWorker({ client, maxRows });

  // Отчёт печатается всегда, в том числе на пустой очереди: «ничего не нашёл»
  // и «не запускался» обязаны различаться в логе. Политика печатается вместе с
  // результатом — иначе по логу нельзя сказать, каким правилом считали.
  process.stdout.write(`${JSON.stringify({
    worker: "change-impact",
    policy: result.policy,
    scanned: result.scanned,
    calculated: result.calculated,
    calculatedTruncated: result.calculatedTruncated,
    alreadyPresent: result.alreadyPresent,
    staleState: result.staleState,
    unresolved: result.unresolved,
    failedRetrying: result.failedRetrying,
    failedDeadLetter: result.failedDeadLetter,
    needsAttention: result.needsAttention,
    // Идентификаторы проектов и заявок — не PII; имён, контактов и текста
    // причины изменения здесь нет и быть не может.
    items: result.items,
  })}\n`);

  if (result.needsAttention > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`change-impact worker failed: ${String(error)}\n`);
  process.exitCode = 1;
});
