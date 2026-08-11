import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Мост к системному воркеру продуктового мозга.
 *
 * Гейт 2 требует провести выдачу через браузер, а выдача адресуется артефакту
 * выпуска. Артефакт собирает `projectceo_product_api.build_release_artifact` —
 * операция системная: права только у `service_role`, автор записи —
 * `system:projectceo-product-worker`. Человеческой двери к ней нет и не
 * планируется, поэтому браузерная цепочка её и не изображает: здесь ровно тот
 * шаг, который в продакшене делает воркер, и ничего сверх.
 *
 * Почему psql, а не HTTP: артефакт собирается из приватной таблицы
 * `projectceo_product.production_package_versions`, а приватные схемы намеренно
 * не отданы Data API (`verify-runtime.mjs` требует от них 406). Воркер ходит в
 * базу, а не через PostgREST, — так это выглядит и здесь.
 */
export function materializeReleaseArtifact(input: {
  readonly projectId: string;
  readonly productionPackageVersionId: string;
  readonly artifactId: string;
}): void {
  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (!databaseUrl) {
    throw new Error(
      "AP5: не задан SUPABASE_DB_URL — сборку артефакта выпуска выполняет"
      + " системный воркер, и без доступа к базе шаг невыполним",
    );
  }
  execFileSync(
    "psql",
    [
      databaseUrl,
      "-X",
      "--set", "ON_ERROR_STOP=1",
      "-v", `project_id=${input.projectId}`,
      "-v", `version_id=${input.productionPackageVersionId}`,
      "-v", `artifact_id=${input.artifactId}`,
      // Ключ идемпотентности детерминированный: повтор шага обязан вернуть
      // прежний артефакт, а не завести второй.
      "-v", `idempotency_key=ap5-build-release-${input.artifactId}`,
      "-f", resolve(process.cwd(), "tests/ap5/materialize-release-artifact.sql"),
    ],
    { stdio: "pipe", encoding: "utf8" },
  );
}
