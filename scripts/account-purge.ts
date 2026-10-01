// Оператор: уничтожение данных дизайнера после запроса удаления (DEC-047:
// в течение 30 дней). Запуск:
//   npx tsx scripts/account-purge.ts list
//   PURGE_DATABASE_URL='postgresql://supabase_admin:…@127.0.0.1:15432/postgres' \
//     npx tsx scripts/account-purge.ts purge <designer-uuid> "<оператор>"
//
// `list` — закрытые аккаунты, у которых срок уничтожения уже наступил.
// `purge`:
//   1. файлы проектов дизайнера удаляются через Storage API (service role):
//      иначе они остались бы на диске хранилища;
//   2. данные в базе удаляет public.purge_designer_account — одной
//      транзакцией, под суперпользователем базы (PURGE_DATABASE_URL, через
//      SSH-туннель; см. deploy/self-hosted/README.md). Если что-то мешает
//      (срок, legal hold, остались файлы, чужие записи), база отказывает и
//      ничего не удаляет.
// Итог — квитанция (номер, дата, число строк по таблицам) без данных
// дизайнера; её номер сообщается дизайнеру как подтверждение удаления.
import { spawnSync } from "node:child_process";
import { createScopedServiceClient } from "@/lib/supabase/token-scoped";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type StorageObject = { bucket: string; name: string };

async function removeFiles(designerId: string): Promise<number> {
  const client = createScopedServiceClient("operator-account-purge");
  const listed = await client.rpc("account_purge_storage_objects", { p_designer_id: designerId });
  // Заявки нет: аккаунт уже уничтожен или не запрашивал удаления — решает база.
  if (listed.error?.message.includes("NO_ACTIVE_CASE")) return 0;
  if (listed.error) throw new Error(listed.error.message);
  const objects = (listed.data ?? []) as StorageObject[];
  const byBucket = new Map<string, string[]>();
  for (const object of objects) byBucket.set(object.bucket, [...(byBucket.get(object.bucket) ?? []), object.name]);
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += 100) {
      const removed = await client.storage.from(bucket).remove(names.slice(i, i + 100));
      if (removed.error) throw new Error(`storage_remove_failed:${bucket}:${removed.error.message}`);
    }
  }
  const again = await client.rpc("account_purge_storage_objects", { p_designer_id: designerId });
  if (again.error) throw new Error(again.error.message);
  if (((again.data ?? []) as StorageObject[]).length > 0) throw new Error("storage_files_remain");
  return objects.length;
}

function purgeDatabase(designerId: string, operator: string): string {
  const url = process.env.PURGE_DATABASE_URL;
  if (!url) throw new Error("PURGE_DATABASE_URL не задан (строка подключения суперпользователя базы)");
  const sql = [
    "begin;",
    "set local session_replication_role = replica;",
    "select public.purge_designer_account(:'designer'::uuid, :'operator');",
    "commit;",
  ].join("\n");
  const result = spawnSync(
    "psql",
    [url, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-v", `designer=${designerId}`, "-v", `operator=${operator}`],
    { input: sql, encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || "psql_failed").trim());
  return result.stdout.trim();
}

async function main() {
  const [command, designerId, operator] = process.argv.slice(2);
  if (command === "list") {
    const client = createScopedServiceClient("operator-account-purge");
    const result = await client.rpc("list_expired_account_retention_cases");
    if (result.error) throw new Error(result.error.message);
    process.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
    return;
  }
  if (command === "purge" && UUID.test(designerId ?? "") && operator?.trim()) {
    const files = await removeFiles(designerId!);
    process.stdout.write(`files removed: ${files}\n`);
    process.stdout.write(`${purgeDatabase(designerId!, operator.trim())}\n`);
    return;
  }
  throw new Error('usage: account-purge list | purge <designer-uuid> "<operator>"');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
