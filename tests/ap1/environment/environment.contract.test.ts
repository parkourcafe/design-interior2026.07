import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../..");
const configPath = resolve(repoRoot, "supabase/config.toml");
const rolesPath = resolve(repoRoot, "supabase/roles.sql");
const authCompatPath = resolve(
  repoRoot,
  "tests/ap1/environment/apply-local-auth-compat.sql",
);
const runnerPath = resolve(repoRoot, "tests/ap1/environment/run-local.zsh");
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

  it("pins a local-only project and non-default port range", () => {
    expect(config).toContain('project_id = "archidom-ap1-disposable"');
    for (const port of [59620, 59621, 59622, 59623, 59624, 59625, 59626, 59627, 59628, 59629]) {
      expect(config).toContain(String(port));
    }
    expect(config).not.toMatch(/project_ref|access_token|service_role|supabase\.co/i);
  });

  it("exposes only the approved public and request-bound API schemas", () => {
    const api = section(config, "api");
    expect(api).toContain('"public"');
    expect(api).toContain('"projectceo_api"');
    expect(api).toContain('"projectceo_read_api"');
    expect(api).toContain('"projectceo_product_api"');
    expect(api).toContain('"projectceo_m4_api"');
    expect(api).toContain("auto_expose_new_tables = false");
    expect(api).not.toMatch(/project_intelligence|projectceo_foundation|projectceo_product"|projectceo_m4"/);
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
    expect(runner).toContain("--exclude imgproxy,mailpit");
    expect(runner).not.toMatch(/--exclude[^\n]*(?:rest|storage|kong|db)/);
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

  it("adds only auth schema lookup to the guarded table owner", () => {
    const compat = readFileSync(authCompatPath, "utf8");
    expect(compat).toContain(
      "grant usage on schema auth to pi_table_owner, pi_human_executor",
    );
    expect(compat).toContain("AP1_AUTH_TABLE_PRIVILEGE_SCOPE_INVALID");
    expect(compat).toContain("privilege.table_name = 'users'");
    expect(compat).toContain("create policy projectceo_pi_table_owner_select");
    expect(compat).toContain("to pi_table_owner");
    expect(compat).toContain("AP1_AUTH_USERS_POLICY_SCOPE_INVALID");
    expect(compat).not.toMatch(/grant usage on schema auth to pi_worker_executor/);
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
