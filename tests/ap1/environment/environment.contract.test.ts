import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../..");
const configPath = resolve(repoRoot, "supabase/config.toml");
const rolesPath = resolve(repoRoot, "supabase/roles.sql");
const authCompatPath = resolve(
  repoRoot,
  "tests/ap1/environment/apply-local-auth-compat.sql",
);
const authAuthorizationMigrationPath = resolve(
  repoRoot,
  "supabase/migrations/20260801120000_projectceo_request_claim_authorization.sql",
);
const runnerPath = resolve(repoRoot, "tests/ap1/environment/run-local.zsh");
const verifyDbPath = resolve(repoRoot, "tests/ap1/environment/verify-db.sql");
const ledgerPath = resolve(
  repoRoot,
  "tests/ap1/environment/migration-ledger.sha256",
);

function section(source: string, name: string): string {
  const marker = `[${name}]`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`missing TOML section ${marker}`);
  const rest = source.slice(start + marker.length);
  const next = rest.search(/^\[/m);
  return next === -1 ? rest : rest.slice(0, next);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("AP1 disposable Supabase environment contract", () => {
  const config = readFileSync(configPath, "utf8");

  it.each([
    { runtime: "invalid", fresh: "1", reason: null },
    { runtime: "1", fresh: "0", reason: "DB4_NATIVE_RUNTIME_REQUIRES_FRESH_MODE" },
    { runtime: "1", fresh: "invalid", reason: "DB4_NATIVE_RUNTIME_REQUIRES_FRESH_MODE" },
  ])("rejects invalid native durability mode before Docker startup ($runtime/$fresh)", ({ runtime, fresh, reason }) => {
    const result = spawnSync("/bin/zsh", [resolve(repoRoot, "tests/db4/run.zsh")], {
      cwd: repoRoot, encoding: "utf8", timeout: 5000,
      env: { ...process.env, PI_DB4_NATIVE_RUNTIME: runtime, PI_DB4_NATIVE_FRESH: fresh },
    });
    expect(result.status).toBe(64);
    expect(result.stdout).not.toContain("DB4 harness image");
    if (reason) expect(result.stderr).toContain(reason);
  });

  it("pins a local-only project and non-default port range", () => {
    expect(config).toContain('project_id = "archidom-ap1-disposable"');
    for (const port of [59620, 59621, 59622, 59623, 59624, 59625, 59626, 59627, 59628, 59629]) {
      expect(config).toContain(String(port));
    }
    // `custom_access_token` is the approved local Auth Hook name, not a
    // credential. Reject only secret-bearing settings and hosted references.
    expect(config).not.toMatch(/project_ref|service_role|supabase\.co/i);
    expect(config).not.toMatch(/^\s*(?:anon|service|access)_key\s*=/im);
    expect(config).toContain("[auth.hook.custom_access_token]");
  });

  it("exposes only the approved public and request-bound API schemas", () => {
    const api = section(config, "api");
    expect(api).toContain('"public"');
    expect(api).toContain('"projectceo_api"');
    expect(api).toContain('"projectceo_read_api"');
    expect(api).toContain('"projectceo_product_api"');
    // M3 отдан Data API намеренно: листы документации вызываются приложением
    // через PostgREST. Приватная projectceo_m3 при этом закрыта — проверка
    // ниже в том же регулярном отрицании.
    expect(api).toContain('"projectceo_m3_api"');
    expect(api).toContain('"projectceo_m4_api"');
    expect(api).toContain("auto_expose_new_tables = false");
    expect(api).not.toMatch(
      /project_intelligence|projectceo_foundation|projectceo_product"|projectceo_m3"|projectceo_m4"/,
    );
  });

  it("enables Auth and Storage without anonymous sign-in or optional mail UI", () => {
    expect(section(config, "auth")).toMatch(/enabled = true/);
    expect(section(config, "auth")).toMatch(/enable_anonymous_sign_ins = false/);
    expect(section(config, "auth.email")).toMatch(/enable_confirmations = true/);
    expect(section(config, "local_smtp")).toMatch(/enabled = false/);
    expect(section(config, "storage")).toMatch(/enabled = true/);
  });

  it("runs only on the isolated socket with the minimal authenticated stack", () => {
    const runner = readFileSync(runnerPath, "utf8");
    expect(runner).toContain("AP1_DOCKER_HOST_REJECTED");
    expect(runner).toContain("AP1_LINKED_PROJECT_REJECTED");
    expect(runner).toContain("--exclude edge-runtime,imgproxy,mailpit");
    expect(runner).not.toMatch(/--exclude[^\n]*(?:rest|storage|kong|db)/);
  });

  it("redacts quoted Supabase status keys before they reach runtime logs", () => {
    const runner = readFileSync(runnerPath, "utf8");
    expect(runner).toContain("PUBLISHABLE_KEY");
    expect(runner).toContain("PUBLISHABLE_KEY|ANON_KEY|SERVICE_ROLE_KEY");
  });

  it("accepts the wrapper disposable socket and rejects the legacy socket before runtime", () => {
    const root = mkdtempSync(resolve(tmpdir(), "wp32-socket-"));
    const env = { ...process.env, AP1_SUPABASE_BIN: "/usr/bin/true", AP1_CLI_HOME: resolve(root, "home"), AP1_NPM_CACHE: resolve(root, "cache") };
    try {
      const accepted = spawnSync("zsh", [runnerPath, "version"], {
        env: { ...env, DOCKER_HOST: "unix:///Users/test/.colima/archidom-ap1-disposable/docker.sock" }, encoding: "utf8",
      });
      expect(accepted.status).toBe(0);
      const rejected = spawnSync("zsh", [runnerPath, "version"], {
        env: { ...env, DOCKER_HOST: "unix:///Users/test/.colima/archidom-ap1/docker.sock" }, encoding: "utf8",
      });
      expect(rejected.status).toBe(65);
      expect(rejected.stderr).toContain("AP1_DOCKER_HOST_REJECTED");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("uses the same disposable profile through the Kora producer and five-session guard", () => {
    const producer = readFileSync(resolve(repoRoot, "tests/pilot-evidence/executors/kora-five-session-producer.zsh"), "utf8");
    const fiveSessionPath = resolve(repoRoot, "tests/ap1/e2e/run-five-sessions.zsh");
    expect(producer).toContain(".colima/archidom-ap1-disposable/docker.sock");
    const root = mkdtempSync(resolve(tmpdir(), "wp32-five-session-guard-"));
    const env = { ...process.env, AP1_KORA_SITE_PHOTO: resolve(root, "absent-photo.jpg") };
    try {
      const accepted = spawnSync("zsh", [fiveSessionPath], {
        env: { ...env, DOCKER_HOST: `unix://${process.env.HOME}/.colima/archidom-ap1-disposable/docker.sock` }, encoding: "utf8",
      });
      expect(accepted.status).toBe(66);
      expect(accepted.stderr).toContain("AP1_KORA_SITE_PHOTO_REQUIRED");
      const rejected = spawnSync("zsh", [fiveSessionPath], {
        env: { ...env, DOCKER_HOST: `unix://${process.env.HOME}/.colima/archidom-ap1/docker.sock` }, encoding: "utf8",
      });
      expect(rejected.status).toBe(65);
      expect(rejected.stderr).toContain("AP1_DOCKER_HOST_REJECTED");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps Kora authenticated-read counts aligned with the registered site photo", () => {
    const provision = readFileSync(resolve(repoRoot, "tests/ap1/e2e/provision-kora.ts"), "utf8");
    const fiveSession = readFileSync(resolve(repoRoot, "tests/ap1/e2e/run-five-sessions.zsh"), "utf8");
    for (const marker of ["physicalRecords !== 210", "materializedRecords !== 82", "uniqueBlobs !== 29"]) {
      expect(provision).toContain(marker);
    }
    for (const marker of ["physicalRecords == 210", "materializedRecords == 82", "uniqueBlobs == 29"]) {
      expect(fiveSession).toContain(marker);
    }
  });

  it("defines the photo milestone against the provisioned release version", () => {
    const fiveSession = readFileSync(resolve(repoRoot, "tests/ap1/e2e/run-five-sessions.zsh"), "utf8");
    expect(fiveSession).toContain("release_version=$(jq -er '.result.productionPackageVersionId // .result.versionId // .result.id'");
    expect(fiveSession).toContain('kind:"publish_baseline"');
    expect(fiveSession).toContain('kind:"publish_release"');
    expect(fiveSession).toContain("worker:release-artifacts");
    expect(fiveSession).toContain("define-milestone-rpc.ts");
    expect(fiveSession).not.toContain("'package-db4-work-v1',");
  });

  it("persists the server-derived latest version instead of a fixture release ID", () => {
    const provision = readFileSync(resolve(repoRoot, "tests/ap1/e2e/provision-kora.ts"), "utf8");
    expect(provision).toContain("releaseVersionId: null");
    expect(provision).toContain("guestReleaseVersionId: null");
    expect(provision).not.toContain('releaseVersionId: "package-db4-root-v1"');
  });

  it("bootstraps only guarded NOLOGIN Project Intelligence roles", () => {
    const roles = readFileSync(rolesPath, "utf8");
    for (const role of ["pi_table_owner", "pi_human_executor", "pi_worker_executor"]) {
      expect(roles).toContain(`create role ${role} nologin noinherit nobypassrls`);
    }
    expect(roles).toContain(
      "grant pi_table_owner, pi_human_executor, pi_worker_executor to postgres",
    );
    expect(roles).not.toMatch(/\b(?:login|superuser|createdb|createrole|replication)\b/i);
  });

  it("resolves actors from request claims without auth-schema inheritance", () => {
    const compat = readFileSync(authCompatPath, "utf8");
    expect(compat).not.toMatch(/grant usage on schema auth/i);
    expect(compat).toContain("AP1_AUTH_SCHEMA_COMPAT_GRANT_MUST_NOT_EXIST");
    expect(compat).toContain("AP1_AUTH_TABLE_PRIVILEGE_SCOPE_INVALID");
    expect(compat).toContain("revoke all on table auth.users");
    expect(compat).toContain("AP1_AUTH_USERS_POLICY_SCOPE_INVALID");
    expect(compat).not.toContain("create policy projectceo_pi_table_owner_select");
    expect(compat).not.toMatch(/grant authenticated to pi_table_owner/i);
  });

  it("re-checks the deployed database for managed-auth references and claim readers", () => {
    const verify = readFileSync(verifyDbPath, "utf8");
    expect(verify).toContain("AP1_MANAGED_AUTH_REFERENCE_REMAINS");
    expect(verify).toContain("AP1_REQUEST_CLAIM_READERS_INVALID");
    // Guard'а миграции 20260801120000 нет для этих двух схем — постоянная
    // проверка обязана покрывать их, иначе дыра остаётся открытой.
    expect(verify).toContain("'project_intelligence_api'");
    expect(verify).toContain("'projectceo_read_api'");
  });

  it("rewrites every ProjectCEO auth callsite and fails closed if one remains", () => {
    const migration = readFileSync(authAuthorizationMigrationPath, "utf8");
    expect(migration).toContain("current_setting('request.jwt.claim.sub', true)");
    expect(migration).toContain("current_setting('request.jwt.claims', true)");
    expect(migration).toContain("pg_get_functiondef");
    expect(migration).toContain("PROJECTCEO_MANAGED_AUTH_REFERENCE_REMAINS");
    expect(migration).not.toMatch(/grant\s+authenticated\s+to\s+pi_table_owner/i);
  });

  it("says at the point of use which bootstrap path this folder is", () => {
    // Папка молчала с 01.08.2026: `0001`–`0007` из неё убрали, а объяснения,
    // почему нумерация начинается с середины и чем кончился второй путь, в ней
    // не появилось. Молчащая папка приглашает восстановить «недостающие» файлы
    // — ровно то, что один раз уже уронило Preview на baseline guard.
    const readme = readFileSync(
      resolve(repoRoot, "supabase/migrations/README.md"),
      "utf8",
    );
    expect(readme).toContain("20260716071024_legacy_production_baseline.sql");
    expect(readme).toContain("migration-ledger.sha256");
    expect(readme).toContain("bootstrap-disposable.zsh");
    // Оба пути названы, и historical явно объявлен не путём этой папки.
    expect(readme).toMatch(/clean-bootstrap/);
    expect(readme).toMatch(/historical incremental/);
    expect(readme).toContain("AP1_MIGRATION_PATH_DECISION_2026-08-01.md");
  });

  it("keeps the exact immutable migration ledger", () => {
    const expected = readFileSync(ledgerPath, "utf8")
      .trim()
      .split("\n")
      .map<{ digest: string; path: string }>((line) => {
        const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
        if (!match) throw new Error(`invalid migration ledger line: ${line}`);
        return { digest: match[1]!, path: match[2]! };
      });
    const actualPaths = readdirSync(resolve(repoRoot, "supabase/migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => `supabase/migrations/${name}`);

    expect(expected.map(({ path }) => path)).toEqual(actualPaths);
    for (const { digest, path } of expected) {
      expect(sha256(resolve(repoRoot, path)), path).toBe(digest);
    }
  });
});
