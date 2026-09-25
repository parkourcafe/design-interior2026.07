import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * DEC-040 (4): baseline M3 публикуется только с опубликованной передачей
 * M2→M3 по каждому пакету (миграция 20260925100000). Цепочка Kora проверяет
 * браузерный путь M3, а не M2: полный путь M2 (варианты планировки → ревью
 * клиента → approved commit → publish_m2_m3_handoff) доказывают DB4 33 и
 * внешний раннер AP6. Поэтому перед каждой публикацией baseline харнесс
 * засевает опубликованную передачу операторским psql-доступом — тем же, каким
 * workflow применяет enable-скрипты (см. coverage-graph.ts). Design intent
 * передачи — решение, которое войдёт в baseline, иначе база откажет
 * M2_HANDOFF_NOT_IN_BASELINE.
 *
 * Это фикстура одноразовой базы, не продуктовая поверхность: схема
 * pi_test_fixture создаётся только здесь и в DB4/DB5.
 */
export function seedM3HandoffsForBaseline(input: {
  readonly projectId: string;
  readonly designIntentRevisionId: string;
}): void {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!uuid.test(input.projectId)) throw new Error("AP5: projectId для засева передачи — не UUID");
  if (!/^[A-Za-z0-9._:@-]{1,160}$/.test(input.designIntentRevisionId)) {
    throw new Error("AP5: недопустимый designIntentRevisionId для засева передачи");
  }
  const fixture = resolve(process.cwd(), "tests/fixtures/sql/m3_handoff_fixture.sql");
  const seedSql = `select pi_test_fixture.seed_handoff(
      package.project_id, package.id, 'ap5-handoff-' || package.stable_key,
      '${input.designIntentRevisionId}', array['ap5-handoff-selection'],
      (select designer_id from public.projects where id = package.project_id))
    from projectceo_foundation.project_packages package
    where package.project_id = '${input.projectId}'::uuid and package.status = 'active'`;
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error("AP5: засев передачи M2→M3 требует SUPABASE_DB_URL");
  }
  try {
    execFileSync(process.env.AP5_PSQL_BIN ?? "psql", [
      dbUrl, "-X", "--set", "ON_ERROR_STOP=1", "-f", fixture, "-c", seedSql,
    ], { stdio: "pipe", encoding: "utf8" });
    return;
  } catch (error) {
    const detail = error as { readonly code?: string; readonly status?: number };
    const container = process.env.AP5_POSTGRES_CONTAINER;
    if (detail.code !== "ENOENT" || !container) {
      throw new Error(
        `AP5: засев передачи не выполнен: exit=${detail.status ?? "unknown"}`
        + ` code=${detail.code ?? "unknown"}`,
      );
    }
  }
  execFileSync("docker", [
    "exec", "-i", process.env.AP5_POSTGRES_CONTAINER!, "psql", "-X", "--set", "ON_ERROR_STOP=1",
    "--username", "postgres", "--dbname", "postgres", "-f", "-", "-c", seedSql,
  ], {
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
    input: readFileSync(fixture, "utf8"),
  });
}
