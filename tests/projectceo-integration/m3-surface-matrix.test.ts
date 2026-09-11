import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  M3_APP_GATE_ONLY_SIGNATURES,
  M3_REVOKED_SIGNATURES,
  M3_SURFACE,
  M3_SURFACE_COMMANDS,
} from "../../lib/project-intelligence/delivery/projectceo/m3-surface";
import { DOCUMENTATION_PUBLICATION } from "../../lib/project-intelligence/delivery/projectceo/documentation-flag";

const repoRoot = process.cwd();
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

/**
 * Матрица поверхности M3 — источник истины, а не иллюстрация. Эти тесты и есть
 * то самое «любой новый M3 RPC без классификации роняет CI»: пока список живёт
 * в трёх местах (командный сервис, миграция guardrail'а, адаптеры), разойтись
 * они могут молча, и заметить это можно было бы только браузерным прогоном.
 */
describe("M3 surface matrix", () => {
  it("covers every command the module flag closes, and nothing else", () => {
    const documentationModule = read(
      "lib/project-intelligence/delivery/projectceo/command-service.ts",
    );
    const block = documentationModule.slice(
      documentationModule.indexOf("const DOCUMENTATION_MODULE"),
      documentationModule.indexOf("const MAX_INVITATION_TTL_MS"),
    );
    // Только элементы списка, каждый на своей строке: `ProjectCeoCommand["kind"]`
    // в аннотации типа — не команда, и первая редакция теста поймала именно это.
    const gated = [...block.matchAll(/^\s{2}"([a-z_]+)",$/gm)].map((match) => match[1]!);
    const expanded = [...gated, ...DOCUMENTATION_PUBLICATION];

    expect([...M3_SURFACE_COMMANDS].sort()).toEqual([...new Set(expanded)].sort());
  });

  it("names every surface group the owner asked to see", () => {
    expect([...new Set(M3_SURFACE.map((row) => row.surface))].sort()).toEqual([
      "baseline",
      "documentation_sheets",
      "intake",
      "release",
      "review",
    ]);
  });

  it("classifies every RPC and states one honest off-state", () => {
    for (const row of M3_SURFACE) {
      expect(row.offState, row.command).toBe("module_disabled");
      expect(row.rpcs.length, row.command).toBeGreaterThan(0);
      for (const rpc of row.rpcs) {
        expect(rpc.signature.startsWith(`${rpc.schema}.${rpc.name}(`), rpc.signature).toBe(true);
        expect(["m3_only", "shared_schema"]).toContain(rpc.sharing);
        expect(["revoked_from_authenticated", "app_gate_only"]).toContain(rpc.closure);
      }
    }
  });

  /**
   * Матрица и миграция обязаны говорить одно и то же. Разойдись они — матрица
   * стала бы описанием желаемого, а не действительного, что хуже отсутствия
   * матрицы: ей бы верили.
   */
  it("matches the guardrail migration signature for signature", () => {
    const migrations = [
      "supabase/migrations/20260811010000_projectceo_m3_publication_guardrail.sql",
      "supabase/migrations/20260911160000_projectceo_m3_atomic_publication_flip.sql",
    ];
    const revokeBlock = migrations.map((path) => {
      const migration = read(path);
      return migration.slice(
        migration.indexOf("revoke execute on function"),
        migration.indexOf("from authenticated;"),
      );
    }).join("\n");
    for (const signature of M3_REVOKED_SIGNATURES) {
      const withoutSpaces = signature.replace(/\s+/g, "");
      expect(revokeBlock.replace(/\s+/g, "")).toContain(withoutSpaces);
    }
    // И обратно: миграция не отзывает ничего, чего нет в матрице.
    const revokedInMigration = revokeBlock
      .split("\n")
      .map((line) => line.trim().replace(/,$/, ""))
      .filter((line) => line.includes("(") && line.includes("."));
    expect([...new Set(revokedInMigration)].sort()).toEqual(
      [...M3_REVOKED_SIGNATURES].sort(),
    );
  });

  it("keeps the enable script to module-gated M3 doors only", () => {
    const enable = read("tests/ap1/environment/enable-m3-publication.sql").replace(/\s+/g, "");
    const moduleGated = M3_SURFACE
      .flatMap((row) => row.rpcs)
      .filter((rpc) => rpc.closure === "revoked_from_authenticated")
      .map((rpc) => rpc.signature);
    for (const signature of moduleGated) {
      expect(enable).toContain(signature.replace(/\s+/g, ""));
    }
    // Raw doors остаются закрытыми после флипа и не возвращаются disposable
    // M3 switch: они не являются безопасной поверхностью включённого модуля.
    for (const signature of M3_REVOKED_SIGNATURES.filter(
      (signature) => !moduleGated.includes(signature),
    )) {
      expect(enable).not.toContain(signature.replace(/\s+/g, ""));
    }
  });

  /**
   * Остаток «закрыто только приложением» — намеренный и названный. Тест не
   * требует его отсутствия (это была бы ложь о сегодняшнем состоянии), но
   * требует, чтобы он не рос молча: список зафиксирован здесь, и добавление в
   * него роняет CI до тех пор, пока владелец не увидит новую строку.
   */
  it("pins the residue closed by the application boundary alone", () => {
    expect([...M3_APP_GATE_ONLY_SIGNATURES]).toEqual([
      "projectceo_api.register_source_inventory(uuid, jsonb, jsonb, bigint, text)",
    ]);
  });

  /**
   * Сценарий DB4 сверяет матрицу с настоящей базой, и делать это он может
   * только по собственному списку — SQL не импортирует TypeScript. Значит
   * списка два, и разойтись они не имеют права: здесь это и проверяется.
   */
  it("keeps the DB4 classification scenario mirroring the matrix", () => {
    const scenario = read("tests/db4/06_m3_surface_classification.sql");
    for (const rpc of M3_SURFACE.flatMap((row) => row.rpcs)) {
      expect(scenario, rpc.signature).toContain(`'${rpc.signature}'`);
    }
    // Схема модуля содержит цифру (`projectceo_m3_api`) — класс без цифр
    // молча пропускал ровно те две строки, ради которых тест и написан.
    const listed = [...scenario.matchAll(/'([a-z0-9_]+\.[a-z0-9_]+\([^']*\))'/g)]
      .map((match) => match[1]!);
    expect([...new Set(listed)].sort()).toEqual(
      [...new Set(M3_SURFACE.flatMap((row) => row.rpcs).map((rpc) => rpc.signature))].sort(),
    );
  });

  /**
   * Адаптеры зовут только то, что классифицировано. Новый вызов
   * `projectceo_m3_api.*` без строки в матрице роняет этот тест — то есть новая
   * RPC модуля не может появиться незамеченной.
   */
  it("classifies every projectceo_m3_api call the adapters make", () => {
    const adapter = read("lib/project-intelligence/adapters/postgres/documentation.ts");
    const called = [...adapter.matchAll(/"projectceo_m3_api",\s*\n?\s*"([a-z_]+)"/g)]
      .map((match) => match[1]!);
    const classified = new Set(
      M3_SURFACE.flatMap((row) => row.rpcs)
        .filter((rpc) => rpc.schema === "projectceo_m3_api")
        .map((rpc) => rpc.name),
    );
    expect(called.length).toBeGreaterThan(0);
    for (const name of called) expect([...classified]).toContain(name);
  });
});
