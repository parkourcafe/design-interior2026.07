import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Каталог — подписанный документ; таблица в БД — его отражение. Тест держит
// их в согласии: каждый шаблон документа обязан быть в seed-миграции, и
// наоборот. Расхождение = кто-то поменял одну сторону молча.

const repoRoot = resolve(__dirname, "../..");
const catalogPath = resolve(
  repoRoot,
  "docs/canonical/remhaos-v1/REMHAOS_WORKFLOW_CATALOG_v1.md",
);
const migrationPath = resolve(
  repoRoot,
  "supabase/migrations/20260824160000_projectceo_platform_workflow_templates.sql",
);

const catalog = readFileSync(catalogPath, "utf8");
const migration = readFileSync(migrationPath, "utf8");

const catalogIds = [...catalog.matchAll(/^## (WF-[A-Z0-9]+-\d{3})/gm)].map(
  (match) => match[1],
);

describe("Workflow Catalog v1 ↔ persistence (Фаза 2, A5)", () => {
  it("каталог определяет ровно 5 шаблонов", () => {
    expect(catalogIds).toEqual([
      "WF-M1-001",
      "WF-M2-001",
      "WF-M3-001",
      "WF-M4-001",
      "WF-TG-001",
    ]);
  });

  it("каждый шаблон документа засеян в миграции", () => {
    for (const id of catalogIds) {
      expect(
        migration.includes(`'${id}'`),
        `${id} отсутствует в seed-миграции`,
      ).toBe(true);
    }
  });

  it("миграция не содержит шаблонов вне каталога", () => {
    const seeded = [...migration.matchAll(/\n\s+'(WF-[A-Z0-9]+-\d{3})',/g)].map(
      (match) => match[1],
    );
    expect(seeded.sort()).toEqual([...catalogIds].sort());
  });

  it("статусы авторизации соответствуют каталогу", () => {
    // M1 — Sprint 1; M2/M3/TG — авторизованы аддендумами; M4 — частично.
    expect(migration).toContain("'WF-M1-001', 'm1', 'sprint_1'");
    expect(migration).toContain("'WF-M2-001', 'm2', 'authorized'");
    expect(migration).toContain("'WF-M3-001', 'm3', 'authorized'");
    expect(migration).toContain("'WF-M4-001', 'm4', 'partially_authorized'");
    expect(migration).toContain("'WF-TG-001', 'tg_bridge', 'authorized'");
  });

  it("шаги детальных шаблонов совпадают с каталогом по действиям", () => {
    // WF-M1-001: 8 шагов каталога — в том же порядке.
    const m1Actions = [
      "extract_client_brief",
      "generate_clarifying_questions",
      "build_project_passport",
      "generate_risk_register",
      "build_scope_draft",
      "calculate_fee",
      "generate_proposal_draft",
      "issue_proposal",
    ];
    for (const action of m1Actions) {
      expect(
        migration.indexOf(`"action": "${action}"`),
        `шаг ${action} отсутствует`,
      ).toBeGreaterThan(-1);
    }
    // WF-TG-001: 7 строк таблицы каталога (включая 2a).
    const tgActions = [
      "link_telegram_identity",
      "bind_project_chat",
      "terminate_pending_binding",
      "ingest_channel_update",
      "extract_candidate",
      "review_candidate",
      "notify_release_distributed",
    ];
    for (const action of tgActions) {
      expect(
        migration.indexOf(`"action": "${action}"`),
        `шаг ${action} отсутствует`,
      ).toBeGreaterThan(-1);
    }
  });
});
