// Оператор: уничтожение данных дизайнера после запроса удаления (DEC-047:
// не позднее 30 дней после запроса). Запуск:
//   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/account-purge.ts list
//   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
//   PURGE_DATABASE_URL='postgresql://supabase_admin:…@127.0.0.1:15432/postgres' \
//     npx tsx scripts/account-purge.ts purge <designer-uuid> "<оператор>"
//
// `list` — очередь: все закрытые аккаунты по дедлайну; при просрочке код
// выхода 2.
// `purge` (повтор безопасен и продолжает начатое):
//   1. begin — база проверяет всё (пробный прогон) и только потом фиксирует
//      точку невозврата: заявка «уничтожается», манифест файлов, аренда. При
//      отказе ничего не удалено и восстановление через поддержку возможно;
//   2. файлы из манифеста удаляются через Storage API и отмечаются в базе;
//   3. finish — база одной транзакцией. Отказ базы (например, появилась
//      чужая запись) — run «blocked»: аккаунт закрыт, восстановление
//      невозможно, после устранения причины повторите `purge`.
// База и хранилище — разные системы: общей атомарности нет, есть журнал run
// и продолжение. «Уничтожено полностью» и номер квитанции печатаются только
// после завершения run.
//
// Учения: ACCOUNT_PURGE_STOP_AFTER_FILES=n — аварийная остановка после n
// удалённых файлов; ACCOUNT_PURGE_LEASE_SECONDS — срок аренды (по умолчанию 600).
import { spawnSync } from "node:child_process";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { createScopedServiceClient } from "@/lib/supabase/token-scoped";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type StorageObject = { bucket: string; name: string };
type Run = {
  runId?: string;
  status?: string;
  filesTotal?: number;
  filesDeleted?: number;
  lastError?: string | null;
  receiptId?: string | null;
  stillPresent?: number;
  deadlineMet?: boolean;
  rows?: Record<string, number>;
};

class IncompletePurge extends Error {}

function psql(sql: string, vars: Record<string, string>): string {
  const raw = process.env.PURGE_DATABASE_URL;
  if (!raw) throw new Error("PURGE_DATABASE_URL не задан (строка подключения суперпользователя базы)");
  // Пароль — через окружение psql, а не в аргументах (их видно в списке процессов).
  const url = new URL(raw);
  const password = decodeURIComponent(url.password);
  url.password = "";
  const args = [url.toString(), "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"];
  for (const [key, value] of Object.entries(vars)) args.push("-v", `${key}=${value}`);
  const result = spawnSync("psql", args, {
    input: sql,
    encoding: "utf8",
    env: { ...process.env, PGPASSWORD: password },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || "psql_failed").trim());
  return result.stdout.trim();
}

function inReplica(select: string): string {
  return ["begin;", "set local session_replication_role = replica;", `${select};`, "commit;"].join("\n");
}

async function purge(designerId: string, operator: string) {
  const lease = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const leaseSeconds = process.env.ACCOUNT_PURGE_LEASE_SECONDS ?? "600";
  const stopAfter = Number(process.env.ACCOUNT_PURGE_STOP_AFTER_FILES ?? "NaN");

  // 1. Проверки и точка невозврата.
  const begun = JSON.parse(psql(
    inReplica("select public.begin_account_purge(:'designer'::uuid, :'operator', :'lease', :'lease_seconds'::int)::text"),
    { designer: designerId, operator, lease, lease_seconds: leaseSeconds },
  )) as Run & { resume?: boolean };
  if (begun.status === "already_purged") {
    process.stdout.write(
      "Аккаунта с таким id в базе нет: он уже уничтожен или id указан неверно. Это НЕ подтверждение " +
      "уничтожения. Если ранее печаталась строка «run <id>», квитанция: " +
      "select receipt_id, purged_at, deadline_met from public.account_purge_receipts where run_id = '<id>';\n",
    );
    return;
  }
  const runId = begun.runId!;
  process.stdout.write(`run ${runId}: ${begun.resume ? "продолжение" : "начат"}, файлов в манифесте: ${begun.filesTotal}\n`);

  // 2. Файлы: Storage API, затем отметка в базе. Повтор безопасен.
  let deleted = begun.filesDeleted ?? 0;
  try {
    const pending = JSON.parse(psql("select public.purge_run_files(:'run'::uuid, :'lease')::text", { run: runId, lease })) as
      StorageObject[];
    const client = createScopedServiceClient("operator-account-purge");
    for (let i = 0; i < pending.length; i += 100) {
      let batch = pending.slice(i, i + 100);
      if (Number.isFinite(stopAfter)) batch = batch.slice(0, Math.max(0, stopAfter - deleted));
      if (batch.length === 0) throw new IncompletePurge("учебная остановка (ACCOUNT_PURGE_STOP_AFTER_FILES)");
      const byBucket = new Map<string, string[]>();
      for (const file of batch) byBucket.set(file.bucket, [...(byBucket.get(file.bucket) ?? []), file.name]);
      for (const [bucket, names] of byBucket) {
        const removed = await client.storage.from(bucket).remove(names);
        if (removed.error) throw new IncompletePurge(`storage_remove_failed:${bucket}:${removed.error.message}`);
      }
      const marked = JSON.parse(psql(
        "select public.mark_purge_files_deleted(:'run'::uuid, :'lease', :'files'::jsonb, :'lease_seconds'::int)::text",
        { run: runId, lease, files: JSON.stringify(batch), lease_seconds: leaseSeconds },
      )) as Run;
      deleted = marked.filesDeleted ?? deleted;
      // База отмечает только то, чего в хранилище действительно нет.
      if ((marked.stillPresent ?? 0) > 0) {
        throw new IncompletePurge(`${marked.stillPresent} файл(ов) после удаления всё ещё в хранилище (проверьте адрес NEXT_PUBLIC_SUPABASE_URL)`);
      }
      if (Number.isFinite(stopAfter) && deleted >= stopAfter && i + batch.length < pending.length) {
        throw new IncompletePurge("учебная остановка (ACCOUNT_PURGE_STOP_AFTER_FILES)");
      }
    }

    // 3. База.
    const finished = JSON.parse(psql(
      inReplica("select public.finish_account_purge(:'run'::uuid, :'lease')::text"),
      { run: runId, lease },
    )) as Run;
    if (finished.status === "files_pending") {
      throw new IncompletePurge("в хранилище появились или остались файлы — повторите `purge`, они будут удалены");
    }
    if (finished.status !== "completed") {
      throw new IncompletePurge(`база отказала: ${finished.lastError ?? finished.status}`);
    }
    process.stdout.write(
      `УНИЧТОЖЕНО ПОЛНОСТЬЮ. Квитанция ${finished.receiptId}; файлов: ${finished.filesDeleted}; ` +
      `дедлайн соблюдён: ${finished.deadlineMet ? "да" : "НЕТ"}\n${JSON.stringify(finished.rows ?? {})}\n`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      psql("select public.release_account_purge_lease(:'run'::uuid, :'lease')", { run: runId, lease });
    } catch {
      // Аренда истечёт сама.
    }
    throw new IncompletePurge(
      `уничтожение НЕ завершено (run ${runId}): ${reason}. Удалено файлов: ${deleted} из ${begun.filesTotal}. ` +
      "Аккаунт закрыт, восстановление невозможно. Устраните причину и повторите `purge`.",
    );
  }
}

async function main() {
  const [command, designerId, operator] = process.argv.slice(2);
  if (command === "list") {
    const client = createScopedServiceClient("operator-account-purge");
    const result = await client.rpc("list_account_purge_queue");
    if (result.error) throw new Error(result.error.message);
    const queue = (result.data ?? []) as { overdue?: boolean }[];
    process.stdout.write(`${JSON.stringify(queue, null, 2)}\n`);
    if (queue.some((item) => item.overdue)) {
      process.stderr.write("ВНИМАНИЕ: есть заявки с нарушенным дедлайном уничтожения.\n");
      process.exitCode = 2;
    }
    return;
  }
  if (command === "purge" && UUID.test(designerId ?? "") && operator?.trim()) {
    await purge(designerId!, operator.trim());
    return;
  }
  throw new Error('usage: account-purge list | purge <designer-uuid> "<operator>"');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
