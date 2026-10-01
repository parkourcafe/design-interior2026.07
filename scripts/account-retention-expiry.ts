// Оператор: заявки на удаление, у которых нарушен дедлайн уничтожения (DEC-047:
// 30 дней от запроса; очередь целиком — `account-purge.ts list`). Ничего не
// удаляет (уничтожение — scripts/account-purge.ts). Запуск:
//   npx tsx scripts/account-retention-expiry.ts sweep
//   npx tsx scripts/account-retention-expiry.ts list
//   npx tsx scripts/account-retention-expiry.ts restore <designer-uuid> "<причина>" "<оператор>"
// `sweep` переводит просроченные заявки в `expired` (с журналом);
// `restore` — отмена удаления по просьбе дизайнера (DEC-047: только до начала
// уничтожения; после него база отвечает ACCOUNT_PURGE_IN_PROGRESS).
import { createScopedServiceClient } from "@/lib/supabase/token-scoped";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function main() {
  const [command, designerId, reason, operator] = process.argv.slice(2);
  const client = createScopedServiceClient("operator-account-retention-expiry");
  let result;
  if (command === "sweep") {
    result = await client.rpc("sweep_account_retention_expiry");
  } else if (command === "list") {
    result = await client.rpc("list_expired_account_retention_cases");
  } else if (command === "restore" && UUID.test(designerId ?? "") && reason?.trim() && operator?.trim()) {
    result = await client.rpc("restore_account_retention_case", {
      p_designer_id: designerId,
      p_reason: reason.trim(),
      p_operator: operator.trim(),
    });
  } else {
    throw new Error("usage: account-retention-expiry sweep | list | restore <designer-uuid> <reason> <operator>");
  }
  if (result.error) throw new Error(result.error.message);
  process.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
