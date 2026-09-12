import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activationMetrics, launchMetrics, type LaunchEvent } from "../../lib/analytics/launch-metrics";
import { main } from "../../scripts/ops/launch-metrics";

const event = (type: string, minutes: number, project_id = "p1"): LaunchEvent => ({ type, project_id, created_at: new Date(Date.UTC(2026, 8, 11, 0, minutes)).toISOString() });
const events = [event("intake_link_created", 0), event("brief_started", 1), event("brief_completed", 4), event("brief_completed", 9), event("proposal_created", 6), event("proposal_sent", 7), event("proposal_sent", 20)];

describe("launch metrics", () => {
  it("deduplicates projects and uses first chronological completion/send even for unordered input", () => {
    const report = activationMetrics([...events].reverse());
    expect(report.counts.brief_completed).toBe(1);
    expect(report.counts.proposal_sent).toBe(1);
    expect(report.timeToPassport).toMatchObject({ samples: 1, meanMs: 180_000 });
    expect(report.timeToProposal.meanMs).toBe(180_000);
  });
  it("excludes projects outside link cohort and negative durations; counts error attempts", () => {
    const report = activationMetrics([event("intake_link_created", 0), event("brief_started", 10), event("brief_completed", 5), event("brief_completed", 6, "orphan"), event("intake_submit_failed", 7), event("intake_submit_failed", 8)]);
    expect(report.timeToPassport.samples).toBe(0);
    expect(report.projectsWithoutLink).toBe(1);
    expect(report.counts.brief_completed).toBe(0);
    expect(report.errorEvents.intake_submit_failed).toBe(2);
  });
  it("keeps missing costs unknown and unscoped calls explicit; excludes other modules", () => {
    const result = launchMetrics(events, [{ module: "brief", project_id: "p1", status: "ok", cost_rub: "4" }, { module: "risks", project_id: null, status: "error", cost_rub: null }, { module: "documentation", project_id: "p1", status: "ok", cost_rub: 100 }]);
    expect(result.ai).toMatchObject({ calls: 2, knownCostRub: 4, totalCostRub: null, missingCostCalls: 1, unscopedCalls: 1, status: "INCOMPLETE" });
    expect(launchMetrics([], []).ai.totalCostRub).toBeNull();
    expect(launchMetrics(events, [{ module: "brief", project_id: "p1", status: "ok", cost_rub: 0 }]).ai.totalCostRub).toBe(0);
  });
  it("rejects cost sum overflow", () => {
    expect(() => launchMetrics([], [Number.MAX_SAFE_INTEGER, 1].map((cost_rub) => ({ module: "brief", project_id: "p", status: "ok", cost_rub })))).toThrow("cost_sum_out_of_range");
  });
  it("builds an aggregate-only report through fixture CLI without asserting adoption", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wp28-"));
    try {
      const path = join(dir, "input.json");
      await writeFile(path, JSON.stringify({ events, ai_calls: [] }));
      const report = await main(["--fixture", path]);
      expect(report.source).toBe("FIXTURE");
      expect(report.adoption).toBe("BLOCKED_ON_OWNER");
      expect(JSON.stringify(report)).not.toContain('"p1"');
      expect(report.activation.timeToPassport.samples).toBe(1);
    } finally { await rm(dir, { recursive: true }); }
  });
  it("does not infer database execution from environment or accept unbounded queries", async () => {
    await expect(main([])).rejects.toThrow("usage");
    await expect(main(["--database", "2026-09-12T00:00:00Z", "2026-09-11T00:00:00Z"])).rejects.toThrow("invalid_window");
  });
});


const analyticsState = vi.hoisted(() => ({ role: "owner" as "owner" | "member" | null, clients: 0, eventReads: 0 }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/studio", () => ({ getStudio: async () => analyticsState.role ? { role: analyticsState.role, studioId: "11111111-1111-4111-8111-111111111111" } : null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => {
  analyticsState.clients++;
  return { from: (table: string) => {
    if (table === "events") analyticsState.eventReads++;
    const query = {
      select: () => query,
      eq: (column: string, value: string) => {
        expect(column).toBe("designer_id");
        expect(value).toBe("11111111-1111-4111-8111-111111111111");
        return query;
      },
      order: () => query,
      range: async () => ({ data: [], error: null }),
    };
    return query;
  } };
} }));
import AnalyticsPage from "../../app/dashboard/analytics/page";

describe("owner-only analytics", () => {
  beforeEach(() => { analyticsState.role = "owner"; analyticsState.clients = 0; analyticsState.eventReads = 0; });
  it.each(["member", null] as const)("denies %s before creating the events client", async (role) => {
    analyticsState.role = role;
    await expect(AnalyticsPage()).rejects.toThrow("redirect:/dashboard");
    expect(analyticsState.clients).toBe(0);
    expect(analyticsState.eventReads).toBe(0);
  });
  it("allows the owner to read events", async () => {
    expect(await AnalyticsPage()).toBeTruthy();
    expect(analyticsState.clients).toBe(1);
    expect(analyticsState.eventReads).toBe(1);
  });
});
