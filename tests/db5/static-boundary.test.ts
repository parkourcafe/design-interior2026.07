import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

/**
 * Тестовая роль DB5 — механизм одноразового контейнера, а не часть платформы.
 * Она обязана оставаться невидимой и для постоянной схемы, и для PostgREST:
 * иначе «изолированная тестовая роль» однажды окажется ролью продакшена,
 * которой кто-то выдал права инкремента 2, и заметить это будет уже нечем.
 */
const DB5_TEST_ROLE = "pi_db5_execution_tester";

describe("ProjectCEO M4 static boundary", () => {
  const adapter = read(
    "lib/project-intelligence/adapters/postgres/execution.ts",
  );
  const persistence = read(
    "supabase/migrations/20260717102000_projectceo_m4_execution_persistence.sql",
  );
  const operations = read(
    "supabase/migrations/20260717103000_projectceo_m4_execution_operations.sql",
  );

  it("keeps application code off private tables and caller identity", () => {
    expect(adapter).not.toContain('schema("projectceo_m4")');
    expect(adapter).not.toMatch(/\.from\s*\(/);
    expect(adapter).not.toMatch(
      /\b(?:organization_id|actor_id|actor_user_id|effective_role)\s*:/,
    );
    expect(adapter).toContain('"projectceo_m4_api"');
  });

  it("keeps private M4 persistence owner-only under forced RLS", () => {
    expect(persistence).toContain(
      "alter table projectceo_m4.%I force row level security",
    );
    expect(persistence).toContain(
      "for all to pi_table_owner using (true) with check (true)",
    );
    expect(persistence).not.toMatch(
      /grant\s+(?:select|insert|update|delete|all)[\s\S]{0,160}projectceo_m4\.[\\w\"]+[\s\S]{0,100}to\s+(?:anon|authenticated|service_role)/i,
    );
  });

  it("separates human and worker database grants", () => {
    const humanGrant = operations.slice(
      operations.indexOf("grant execute on function\n  projectceo_m4_api.submit_change_request"),
      operations.indexOf("grant execute on function\n  projectceo_m4_api.calculate_change_impact"),
    );
    const workerGrant = operations.slice(
      operations.indexOf("grant execute on function\n  projectceo_m4_api.calculate_change_impact"),
    );

    expect(humanGrant).toContain("to authenticated");
    expect(humanGrant).not.toContain("calculate_change_impact");
    expect(humanGrant).not.toContain("build_construction_handover");
    expect(workerGrant).toContain("to service_role");
    expect(workerGrant).not.toContain("submit_change_request");
    expect(workerGrant).not.toContain("review_change_impact");
  });

  it("retains bounded traversal and append-only closure guards", () => {
    expect(operations).toContain("max_depth > 20");
    expect(operations).toContain("cardinality(walk.edge_path) < max_depth");
    const impactIdentity = operations.slice(
      operations.indexOf("'impactId', 'impact:'"),
      operations.indexOf("'impactedNodeId', best.current_node_id"),
    );
    expect(impactIdentity).toContain("change_request_id");
    expect(impactIdentity).toContain("v_target_graph_version_id");
    expect(impactIdentity).not.toContain("v_impact_run_id");
    expect(persistence).toContain("reject_append_only_mutation");
    expect(persistence).toContain("m4_milestone_acceptance_closure");
    expect(persistence).toContain("m4_construction_handover_closure");
    expect(persistence).toContain("m4_product_release_impact_review");
    expect(persistence).toContain("from projectceo_m4.change_request_roots root");
    expect(persistence).toContain("from projectceo_m4.impacts root_impact");
    expect(persistence).toContain("root_impact.changed_revision_id = root.to_revision_id");
    expect(persistence).toContain("reject_closed_milestone_photo_mutation");
  });

  it("keeps the DB5 test role out of migrations and out of PostgREST", () => {
    const migrationsDir = resolve(process.cwd(), "supabase/migrations");
    const offenders = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .filter((name) => read(`supabase/migrations/${name}`).includes(DB5_TEST_ROLE));
    expect(offenders).toEqual([]);

    // PostgREST отдаёт наружу только роли из своей конфигурации. Тестовая роль
    // там не упоминается и `nologin`, то есть подключиться под ней нельзя даже
    // зная имя.
    expect(read("supabase/config.toml")).not.toContain(DB5_TEST_ROLE);

    // Заводится она ровно в одном месте, и это место — харнесс.
    const roleFile = read("tests/db5/06_execution_test_role.sql");
    expect(roleFile).toContain(`create role ${DB5_TEST_ROLE}`);
    expect(roleFile).toContain("nologin noinherit nobypassrls");
  });

  it("proves the module boundary before and after the positive chain", () => {
    // Позитивная цепочка сама по себе доказательством не является: она могла
    // бы пройти потому, что кто-то открыл инкремент 2 всем. Поэтому харнесс
    // обязан окружать её двумя проверками запрета, и порядок здесь — предмет
    // теста, а не оформление.
    const harness = read("tests/db5/run.zsh");
    const before = harness.indexOf("05_default_deny_before.sql");
    const enableM4 = harness.indexOf("enable-m4-increment-1.sql");
    const testRole = harness.indexOf("06_execution_test_role.sql");
    const chain = harness.indexOf("20_execution_operations.sql");
    const after = harness.indexOf("90_default_deny_after.sql");

    expect(before).toBeGreaterThan(-1);
    expect(before).toBeLessThan(enableM4);
    expect(enableM4).toBeLessThan(testRole);
    expect(testRole).toBeLessThan(chain);
    expect(chain).toBeLessThan(after);

    // Скрипт среды инкремента 1 не имеет права открыть инкремент 2 — он сам это
    // проверяет и падает `PROJECTCEO_M4_INCREMENT_2_LEAKED`. Здесь мы следим за
    // тем, чтобы эту проверку не выпилили.
    expect(read("tests/ap1/environment/enable-m4-increment-1.sql"))
      .toContain("PROJECTCEO_M4_INCREMENT_2_LEAKED");

    // Человеческие RPC инкремента 2 в сценарии вызываются только тестовой
    // ролью. Ни одного `authenticated` рядом с ними быть не должно.
    const scenario = read("tests/db5/20_execution_operations.sql");
    for (const rpc of [
      "review_change_impact",
      "define_milestone",
      "register_photo_evidence",
      "review_photo_evidence",
      "accept_milestone",
      "register_handover_document",
    ]) {
      const call = scenario.indexOf(`projectceo_m4_api.${rpc}(`);
      expect(call, rpc).toBeGreaterThan(-1);
      const preamble = scenario.slice(Math.max(0, call - 400), call);
      const lastRole = preamble.lastIndexOf("set local role ");
      expect(preamble.slice(lastRole), rpc).toContain(DB5_TEST_ROLE);
    }
  });
});
