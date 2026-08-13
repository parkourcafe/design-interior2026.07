import { execFileSync } from "node:child_process";

/**
 * Запуск НАСТОЯЩЕГО системного воркера расчёта влияния (V1 Impact, W1).
 *
 * Тот же приём и по той же причине, что у воркера артефактов
 * (`release-worker.ts`): psql-мост доказывал бы поведение базы, но не
 * существование воркера. Здесь запускается `npm run worker:change-impact` —
 * ровно тот процесс, который пойдёт в продукт.
 *
 * Очередь воркер находит сам: ни идентификатора заявки, ни глубины обхода ему
 * передавать не нужно и нельзя. Подскажи ему очередь — и останется
 * недоказанным ровно то, ради чего он написан. Глубину он не выбирает вовсе:
 * её держит versioned серверная политика.
 *
 * Системная identity настоящая: скрипт ходит service role ключом. Человеческие
 * команды цепочки при этом идут через браузер своими сессиями — рассмотрение
 * влияния делает архитектор, а не service role.
 *
 * КОД ВОЗВРАТА. Воркер отвечает ненулевым кодом (exit 1), когда результат
 * требует внимания человека: result_limit truncation (ничего не сохранено),
 * unresolved baseline, или dead-letter failure. depth_limit truncations
 * (normal partial_depth outcomes per DEC-034) exit with code 0.
 *
 * Отчёт возвращается в обоих случаях — парсим его независимо от кода возврата.
 */
export interface ChangeImpactWorkerReport {
  readonly scanned: number;
  readonly calculated: number;
  readonly calculatedTruncated: number;
  readonly alreadyPresent: number;
  readonly staleState: number;
  readonly unresolved: number;
  readonly failedRetrying: number;
  readonly failedDeadLetter: number;
  readonly needsAttention: number;
  readonly policy: {
    readonly version: string;
    readonly maxDepth: number;
    readonly maxImpacts: number;
  };
  readonly items: readonly {
    readonly projectId: string;
    readonly changeRequestId: string;
    readonly rootCount: number;
    readonly outcome: string;
    readonly truncationReason: string | null;
  }[];
}

export function runChangeImpactWorker(): ChangeImpactWorkerReport {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "AP5: воркеру расчёта влияния нужны NEXT_PUBLIC_SUPABASE_URL и"
      + " SUPABASE_SERVICE_ROLE_KEY — расчёт системный, человеческой двери к"
      + " нему нет",
    );
  }
  let output: string;
  try {
    output = execFileSync("npm", ["run", "--silent", "worker:change-impact"], {
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey },
    });
  } catch (error) {
    // Отказ обязан называть себя сам: цена непонятной ошибки здесь — сорок
    // пять минут следующего прогона.
    const detail = error as { stderr?: string; stdout?: string; message?: string; status?: number };
    // Exit code 1 is normal when needs_attention > 0 (result_limit truncation,
    // unresolved baseline, dead-letter failure). Parse the report anyway if
    // stdout contains valid JSON.
    const stdout = detail.stdout ?? "";
    const lastLine = stdout.trim().split("\n").at(-1) ?? "";
    try {
      return JSON.parse(lastLine) as ChangeImpactWorkerReport;
    } catch {
      // Stdout doesn't have valid JSON, so this is a real failure.
      throw new Error(
        "AP5: системный воркер расчёта влияния не прошёл.\n"
        + `${detail.message ?? String(error)}\n`
        + `exit code: ${detail.status ?? "unknown"}\n`
        + `stderr: ${detail.stderr ?? "(пусто)"}\n`
        + `stdout: ${stdout}`,
      );
    }
  }
  const line = output.trim().split("\n").at(-1) ?? "";
  try {
    return JSON.parse(line) as ChangeImpactWorkerReport;
  } catch {
    throw new Error(`AP5: воркер расчёта влияния не отдал отчёт JSON. Вывод: ${output}`);
  }
}
