// Системный воркер ингеста источников (M3 backlog #5).
// Запуск: npm run worker:ingest-source-graph
//
// Делает один проход по очереди: находит materialized-записи инвентаря, чьих
// источников ещё нет в графе утверждений, и доводит их до графа системной
// дверью. Без этого шага ревью источника невозможно (`human_reviews` требует
// ревизию в графе), а `sourceRevisionIds` в composition, snapshot token и
// semantic hash остаются пустыми навсегда.
//
// ЭТО НЕ ОТКРЫВАЕТ M3. Воркер не создаёт ни маршрута, ни команды, ни права:
// поверхность модуля закрыта выключателем (`20260824150000`), и запуск
// воркера этого не меняет. Содержимого источника воркер не передаёт вовсе —
// граф синтезирует сервер из строки инвентаря.
//
// Идентичность — только service role: все три RPC (очередь, системная дверь,
// запись отказа) выданы `service_role` и никому больше.
//
// КОД ВОЗВРАТА. Ненулевой, если проход оставил работу оператору: строка ушла
// в dead-letter (нерасшифруемое расширение, исчезнувший автор, исчерпанный
// бюджет повторов). Гонка (`stale_state`) и «уже готово» кодом возврата не
// считаются: следующий проход их доберёт сам.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

import type { PostgresRpcClient } from "../lib/project-intelligence/adapters/postgres";
import { runSourceIngestWorker } from "../lib/project-intelligence/workers/ingest-source-graph/runner";

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
  const maxRows = Number(process.env.INGEST_WORKER_MAX_ROWS ?? "100");

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as PostgresRpcClient;

  const result = await runSourceIngestWorker({ client, maxRows });

  // Отчёт печатается всегда, в том числе на пустой очереди: «ничего не
  // нашёл» и «не запускался» обязаны различаться в логе. Идентификаторы
  // источников выведены из checksum — ни имён файлов, ни PII здесь нет.
  process.stdout.write(`${JSON.stringify({
    worker: "ingest-source-graph",
    scanned: result.scanned,
    ingested: result.ingested,
    alreadyPresent: result.alreadyPresent,
    staleState: result.staleState,
    failedRetrying: result.failedRetrying,
    failedDeadLetter: result.failedDeadLetter,
    needsAttention: result.needsAttention,
    items: result.items,
  })}\n`);

  if (result.needsAttention > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`ingest-source-graph worker failed: ${String(error)}\n`);
  process.exitCode = 1;
});
