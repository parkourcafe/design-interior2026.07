// Оператор: уничтожение данных дизайнера после запроса удаления (DEC-047:
// в течение 30 дней). Запуск:
//   npx tsx scripts/account-purge.ts list
//   PURGE_DATABASE_URL='postgresql://supabase_admin:…@127.0.0.1:15432/postgres' \
//     npx tsx scripts/account-purge.ts purge <designer-uuid> "<оператор>"
//
// `list` — закрытые аккаунты, у которых срок уничтожения уже наступил.
// `purge`:
//   1. пробный прогон в базе (все проверки, откат): если база откажет —
//      ничего не удалено, включая файлы;
//   2. файлы проектов дизайнера удаляются через Storage API (service role):
//      иначе они остались бы на диске хранилища;
//   3. данные в базе удаляет public.purge_designer_account — одной
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

function runPurge(designerId: string, operator: string, dryRun: boolean) {
  const raw = process.env.PURGE_DATABASE_URL;
  if (!raw) throw new Error("PURGE_DATABASE_URL не задан (строка подключения суперпользователя базы)");
  // Пароль — через окружение psql, а не в аргументах (их видно в списке процессов).
  const url = new URL(raw);
  const password = decodeURIComponent(url.password);
  url.password = "";
  const sql = [
    "begin;",
    "set local session_replication_role = replica;",
    `select public.purge_designer_account(:'designer'::uuid, :'operator', ${dryRun ? "true" : "false"});`,
    "commit;",
  ].join("\n");
  return spawnSync(
    "psql",
    [url.toString(), "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-v", `designer=${designerId}`, "-v", `operator=${operator}`],
    { input: sql, encoding: "utf8", env: { ...process.env, PGPASSWORD: password } },
  );
}

// Пробный прогон всегда заканчивается исключением: успех — ACCOUNT_PURGE_DRY_RUN_OK.
function dryRun(designerId: string, operator: string): string {
  const result = runPurge(designerId, operator, true);
  if (result.error) throw result.error;
  const output = `${result.stdout}${result.stderr}`;
  const ok = output.match(/ACCOUNT_PURGE_DRY_RUN_OK:(\{.*\})/);
  if (ok) return ok[1]!;
  if (result.status === 0 && output.includes("already_purged")) return "already_purged";
  throw new Error((result.stderr || "psql_failed").trim());
}

function purgeDatabase(designerId: string, operator: string): string {
  const result = runPurge(designerId, operator, false);
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
    const check = dryRun(designerId!, operator.trim());
    process.stdout.write(`dry run: ${check}\n`);
    if (check === "already_purged") {
      process.stdout.write('{"status": "already_purged"}\n');
      return;
    }
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
