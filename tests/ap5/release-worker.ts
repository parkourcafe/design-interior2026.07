import { execFileSync } from "node:child_process";

/**
 * Запуск НАСТОЯЩЕГО системного воркера артефактов выпуска.
 *
 * До 11.08 здесь стоял psql-мост: спека сама считала дескриптор и звала
 * `build_release_artifact`, изображая воркера. Это доказывало поведение базы,
 * но не существование воркера — а гейт 2 нашёл, что без него `distribute_release`
 * недостижим. Мост заменён вызовом `npm run worker:release-artifacts`
 * (DEC-030): прогон проверяет тот самый процесс, который пойдёт в продукт.
 *
 * Воркер сам находит выпущенные версии без артефакта — ни идентификатора
 * версии, ни идентификатора артефакта ему передавать не нужно и нельзя: если
 * очередь ему подсказать, останется недоказанным ровно то, ради чего он
 * написан.
 *
 * Системная identity здесь настоящая: скрипт ходит service role ключом, как в
 * продакшене ходил бы воркерный процесс. Человеческие команды цепочки при этом
 * идут через браузер своими сессиями — service role их не выполняет.
 */
export function runReleaseArtifactWorker(): {
  readonly scanned: number;
  readonly created: number;
  readonly alreadyPresent: number;
} {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "AP5: воркеру артефактов нужны NEXT_PUBLIC_SUPABASE_URL и"
      + " SUPABASE_SERVICE_ROLE_KEY — сборка артефакта системная, человеческой"
      + " двери к ней нет",
    );
  }
  let output: string;
  try {
    output = execFileSync("npm", ["run", "--silent", "worker:release-artifacts"], {
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey },
    });
  } catch (error) {
    // Урок дефекта 3: отказ обязан называть себя сам, иначе цена непонятной
    // ошибки здесь — сорок пять минут следующего прогона.
    const detail = error as { stderr?: string; stdout?: string };
    throw new Error(
      "AP5: системный воркер артефактов выпуска не прошёл: "
      + `stderrLines=${detail.stderr?.split("\n").length ?? 0} `
      + `stdoutLines=${detail.stdout?.split("\n").length ?? 0}`,
    );
  }
  // Отчёт воркера — последняя строка JSON: он печатает его всегда, в том числе
  // на пустой очереди, чтобы «нечего делать» отличалось от «не запускался».
  const line = output.trim().split("\n").at(-1) ?? "";
  try {
    return JSON.parse(line) as ReturnType<typeof runReleaseArtifactWorker>;
  } catch {
    throw new Error(
      `AP5: воркер не отдал отчёт JSON: outputLines=${output.split("\n").length}`,
    );
  }
}
