// Системный воркер артефактов выпуска (DEC-030, инкремент 1.5).
// Запуск: npm run worker:release-artifacts
//
// Делает один проход по очереди: находит выпущенные версии пакета, у которых
// ещё нет логического артефакта, и собирает его. Без этого шага
// `distribute_release` упирается в отсутствующий артефакт — находка гейта 2.
//
// ЭТО НЕ ОТКРЫВАЕТ M4. Воркер не создаёт ни маршрута, ни команды, ни права:
// человеческая поверхность модуля закрыта флагом приложения и отозванными
// правами в базе, и запуск воркера этого не меняет. Он делает ровно ту работу,
// которую в продукте всегда делала система, а не человек.
//
// Идентичность — только service role: обе RPC (очередь и сборка) выданы
// `service_role` и никому больше.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

import type { PostgresRpcClient } from "../lib/project-intelligence/adapters/postgres";
import { runReleaseArtifactWorker } from "../lib/project-intelligence/workers/release-artifact/runner";

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
  const maxRows = Number(process.env.RELEASE_WORKER_MAX_ROWS ?? "100");

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as PostgresRpcClient;

  const result = await runReleaseArtifactWorker({ client, maxRows });

  // Отчёт печатается всегда, в том числе на пустой очереди: «ничего не нашёл»
  // и «не запускался» обязаны различаться в логе.
  process.stdout.write(`${JSON.stringify({
    worker: "release-artifact",
    scanned: result.scanned,
    created: result.created,
    alreadyPresent: result.alreadyPresent,
    staleState: result.staleState,
    // Идентификаторы версий и артефактов — не PII; имён, контактов и исходных
    // имён файлов здесь нет и быть не может.
    items: result.items,
  })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`release-artifact worker failed: ${String(error)}\n`);
  process.exitCode = 1;
});
