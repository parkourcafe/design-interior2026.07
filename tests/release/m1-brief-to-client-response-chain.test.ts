import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswersMap, PricingConfig, ProposalDefaults, ProposalSection } from "@/lib/types";

// Сквозная цепочка M1 на синтетических данных: бриф → паспорт → риски →
// цена → КП → ответ клиента на публичной ссылке. LLM и база подменены:
// ни сетевых вызовов, ни настоящих секретов.

const llm = vi.hoisted(() => ({ mode: "ok" as "ok" | "fail" }));
vi.mock("@/lib/llm/provider", () => ({
  completeJSON: async () => llm.mode === "fail"
    ? { ok: false, error: "llm_request_failed: offline" }
    : {
      ok: true,
      repaired: false,
      data: [{
        risk_type: "technical",
        evidence: ["старый фонд"],
        impact: "состав работ",
        confidence: "medium",
        designer_action: "Уточнить состояние стяжки",
        proposal_implication: "Обмерный план и обследование — отдельной строкой",
      }],
    },
}));

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));
function row(table: "proposals" | "projects"): Row {
  const found = db.tables[table]?.[0];
  if (!found) throw new Error(`no ${table} row seeded`);
  return found;
}

function fakeClient() {
  return {
    // account_retention_active (DEC-044) — на main не вызывается; синтетический
    // дизайнер не в сроке удаления.
    rpc: async () => ({ data: false, error: null }),
    schema: () => ({
      rpc: async () => ({
        // subjectRevisionCurrent — поле DEC-041 §3; на main оно не читается.
        data: { requests: [{ subjectKind: "project_passport", subjectId: "project-1", status: "approved", subjectRevisionCurrent: true }] },
        error: null,
      }),
    }),
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let op: "select" | "update" | "insert" = "select";
      let patch: Row = {};
      let limit = Infinity;
      let single = false;
      const rows = () => (db.tables[table] ??= []);
      const run = () => {
        if (op === "insert") return { data: null, error: null };
        const hit = rows().filter((row) => filters.every((f) => f(row)));
        if (op === "update") {
          for (const row of hit) Object.assign(row, patch);
          return { data: single ? hit[0] ?? null : hit, error: null };
        }
        const out = hit.slice(0, limit);
        return { data: single ? out[0] ?? null : out, error: null };
      };
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
        in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return q; },
        order: () => q,
        limit: (n: number) => { limit = n; return q; },
        maybeSingle: () => { single = true; return q; },
        update: (p: Row) => { op = "update"; patch = p; return q; },
        insert: (p: Row) => { op = "insert"; rows().push({ ...p }); return q; },
        then: (resolve: (v: ReturnType<typeof run>) => unknown) => Promise.resolve(run()).then(resolve),
      };
      return q;
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true, clientIp: () => "test" }));
vi.mock("@/lib/supabase/token-scoped", () => ({ createScopedServiceClient: () => fakeClient() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeClient() }));
vi.mock("@/lib/studio", () => ({ getStudio: async () => ({ studioId: "designer-1", designer: {} }) }));
vi.mock("@/lib/proposal/latest", () => ({
  getLatestProposal: async () => db.tables.proposals?.[0] ?? null,
}));

import { runRiskPipeline } from "@/lib/brief/pipeline";
import { calcPrice } from "@/lib/pricing/calc";
import { derivePackageRecommendation } from "@/lib/proposal/package";
import { buildProposalSections } from "@/lib/proposal/build";
import { POST as respond } from "@/app/api/proposal/respond/route";
import { rebuildProposal, saveProposal, sendProposal } from "@/app/dashboard/projects/[id]/proposal/actions";

const answers: AnswersMap = {
  object: { type: "flat", area_m2: 62, city: "Синтетический город" },
  asset_horizon: "self_long",
  household: ["kids_now"],
  morning: "high_1bath",
  cooking: "heavy",
  storage: ["clothes", "sport", "books"],
  budget: { range: [2_000_000, 3_000_000] },
  timeline: "urgent",
  style: { refs: ["https://example.invalid/ref"], anti: [], notes: "спокойный минимализм" },
  pain: "мало хранения",
} as AnswersMap;

const pricing: PricingConfig = {
  base_rate_per_m2: 3000,
  multipliers: {
    complexity: { low: 0.9, mid: 1, high: 1.2 },
    urgency: 1.2,
    package: { concept: 0.5, full: 1, full_plus_supervision: 1.3 },
  },
};

const defaults: ProposalDefaults = {
  exclusions: ["Строительно-монтажные работы"],
  revision_limit: 2,
  stage_completion: "Этап закрывается письменным согласованием.",
};

async function briefToProposal() {
  const { passport, cards, llmOk } = await runRiskPipeline(answers);
  const accepted = cards.map((c, i) => ({ ...c, id: `card-${i}`, status: "accepted" as const }));
  const recommendation = derivePackageRecommendation({ passport, answers, riskCards: accepted });
  const price = calcPrice(pricing, {
    area_m2: passport.object.area_m2!,
    complexity: "mid",
    urgent: passport.timeline.urgency === "urgent",
    package: recommendation.package_key,
  });
  const sections = buildProposalSections({
    passport,
    acceptedCards: accepted,
    defaults,
    price,
    packageChoice: recommendation.package_key,
    packageRecommendation: recommendation,
  });
  return { passport, cards, llmOk, price, sections };
}

function seed(status: "draft" | "sent" | "accepted", sections: ProposalSection[]) {
  db.tables = {
    proposals: [{ id: "proposal-1", project_id: "project-1", version: 1, status, public_token: "tok-1", sections }],
    projects: [{ id: "project-1", designer_id: "designer-1", status: status === "draft" ? "proposal_draft" : "proposal_sent" }],
    events: [],
  };
}

const post = (action: string, token = "tok-1") =>
  respond(new Request("http://localhost/api/proposal/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, action }),
  }));

beforeEach(() => { llm.mode = "ok"; db.tables = {}; });

describe("M1 chain: brief → passport → risks → price → proposal", () => {
  it("carries the brief through to a priced proposal with rule and mocked LLM risks", async () => {
    const { passport, cards, llmOk, price, sections } = await briefToProposal();
    expect(llmOk).toBe(true);
    expect(passport.object.area_m2).toBe(62);
    expect(passport.timeline.urgency).toBe("urgent");
    expect(cards.some((c) => c.source === "rule")).toBe(true);
    expect(cards.some((c) => c.source === "llm")).toBe(true);
    expect(Number.isSafeInteger(price.range[0]) && Number.isSafeInteger(price.range[1])).toBe(true);
    expect(price.range[0]).toBeLessThan(price.range[1]);
    const priceSection = sections.find((s) => s.id === "price");
    expect(priceSection?.body).toContain(price.range[0].toLocaleString("ru-RU"));
    expect(sections.find((s) => s.id === "included")?.body)
      .toContain("Обмерный план и обследование — отдельной строкой");
  });

  it("degrades to rule-only risks when the LLM is unavailable, and still prices the proposal", async () => {
    llm.mode = "fail";
    const { cards, llmOk, sections } = await briefToProposal();
    expect(llmOk).toBe(false);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.source === "rule")).toBe(true);
    expect(sections.some((s) => s.id === "price")).toBe(true);
  });
});

describe("M1 chain: client response on the public proposal", () => {
  it("does not accept responses to a draft proposal", async () => {
    seed("draft", []);
    expect((await post("accept")).status).toBe(404);
    expect(db.tables.events).toEqual([]);
  });

  it("rejects unknown actions and unknown tokens", async () => {
    seed("sent", []);
    expect((await post("sign")).status).toBe(400);
    expect((await post("accept", "other")).status).toBe(404);
  });

  it("accepting a sent proposal marks proposal and project accepted; the first answer is final", async () => {
    const { sections } = await briefToProposal();
    seed("sent", sections);
    const first = await post("accept");
    expect(await first.json()).toEqual({ ok: true, response: "proposal_accepted" });
    expect(row("proposals").status).toBe("accepted");
    expect(row("projects").status).toBe("proposal_accepted");

    const second = await post("changes");
    expect(await second.json()).toEqual({ ok: true, response: "proposal_accepted" });
    expect((db.tables.events ?? []).filter((e) => String(e.type).startsWith("proposal_"))).toHaveLength(1);
  });

  it("a change request keeps the proposal sent and the project unaccepted", async () => {
    seed("sent", []);
    expect(await (await post("changes")).json()).toEqual({ ok: true, response: "proposal_changes_requested" });
    expect(row("proposals").status).toBe("sent");
    expect(row("projects").status).toBe("proposal_sent");
  });
});

describe("M1 chain: a sent or accepted proposal is not rewritten behind the client's link", () => {
  it.each(["sent", "accepted"] as const)("save and rebuild leave a %s proposal untouched", async (status) => {
    const original = [{ id: "price", title: "Стоимость", body: "от 100 000 до 120 000 ₽" }];
    seed(status, original);
    // Проверяем отказ и неизменность текста, а не литерал причины: ветка
    // DEC-044 называет её "not_draft".
    expect((await saveProposal("project-1", [{ id: "price", title: "Стоимость", body: "от 1 ₽" }])).ok).toBe(false);
    expect((await rebuildProposal("project-1")).ok).toBe(false);
    expect(row("proposals").sections).toEqual(original);
  });

  it("re-sending an accepted proposal does not roll the acceptance back", async () => {
    seed("accepted", []);
    row("projects").status = "proposal_accepted";
    expect((await sendProposal("project-1")).ok).toBe(false);
    expect(row("proposals").status).toBe("accepted");
    expect(row("projects").status).toBe("proposal_accepted");
  });

  it("a draft proposal can still be edited and sent", async () => {
    seed("draft", []);
    const edited = [{ id: "task", title: "Задача клиента", body: "правка дизайнера" }];
    expect(await saveProposal("project-1", edited)).toEqual({ ok: true });
    expect(row("proposals").sections).toEqual(edited);
    expect(await sendProposal("project-1")).toEqual({ ok: true });
    expect(row("proposals").status).toBe("sent");
    expect(row("projects").status).toBe("proposal_sent");
  });
});
