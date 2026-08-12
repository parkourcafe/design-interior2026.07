import { execFileSync } from "node:child_process";

/**
 * Запуск НАСТОЯЩЕГО системного воркера расчёта влияния (DEC-033, V1 Impact,
 * OWNER GO 12.08.2026).
 *
 * Тот же приём, что и у `release-worker.ts` (DEC-030): прогон вызывает
 * `npm run worker:change-impact`, а не изображает воркера мостом из спеки —
 * иначе недоказанным осталось бы ровно то, ради чего воркер написан.
 *
 * Воркер сам находит заявки без прогона влияния через
 * `list_change_impact_backlog` — ни идентификатора заявки, ни глубины, ни
 * лимита ему передавать не нужно и нельзя: и то и другое — политика сервера
 * (`projectceo_m4._impact_policy()`, DEC-033 LOCKED), а не аргумент вызывающего.
 *
 * Системная identity здесь настоящая: скрипт ходит service role ключом, как в
 * продакшене ходил бы воркерный процесс. Человеческие команды цепочки при этом
 * идут через браузер своими сессиями — service role их не выполняет.
 */
export function runChangeImpactWorker(): {
  readonly scanned: number;
  readonly calculated: number;
  readonly alreadyPresent: number;
  readonly staleState: number;
  readonly failureRecorded: number;
  readonly deadLettered: number;
  readonly items: readonly {
    readonly projectId: string;
    readonly changeRequestId: string;
    readonly outcome: string;
    readonly coverageStatus?: string;
  }[];
} {
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
    const detail = error as { stderr?: string; stdout?: string; message?: string };
    throw new Error(
      "AP5: системный воркер расчёта влияния не прошёл.\n"
      + `${detail.message ?? String(error)}\n`
      + `stderr: ${detail.stderr ?? "(пусто)"}\n`
      + `stdout: ${detail.stdout ?? "(пусто)"}`,
    );
  }
  // Отчёт воркера — последняя строка JSON: он печатает его всегда, в том числе
  // на пустой очереди, чтобы «нечего делать» отличалось от «не запускался».
  const line = output.trim().split("\n").at(-1) ?? "";
  try {
    return JSON.parse(line) as ReturnType<typeof runChangeImpactWorker>;
  } catch {
    throw new Error(`AP5: воркер не отдал отчёт JSON. Вывод: ${output}`);
  }
}
