import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnswersMap, PricingConfig, ProposalDefaults } from "@/lib/types";

// Локальная демонстрация M1 по DEMO.md, шаги 4–7 плюс ответ клиента:
// бриф → паспорт → риски → цена → КП → «Отправить» → публичная страница
// /p/<token> (серверный рендер) → «Принять предложение».
// Всё синтетическое: LLM и база подменены, сети и секретов нет. Это не
// заменяет прогон в браузере на живом Supabase — см. чек-лист в
// docs/ops/autonomy/demo/M1_LOCAL_DEMO.md.
// `npm run demo:m1:local` печатает стенограмму прогона (M1_DEMO_PRINT=1).

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
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true, clientIp: () => "demo" }));
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
import { ru } from "@/lib/i18n/ru";
import { POST as respond } from "@/app/api/proposal/respond/route";
import { sendProposal } from "@/app/dashboard/projects/[id]/proposal/actions";
import PublicProposalPage from "@/app/p/[public_token]/page";

// Синтетический клиент: те же ответы, что в цепочке M1, без реальных ПДн.
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

// Ставки демо-дизайнера — синтетические, не цены продукта.
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

const transcript: string[] = [];
const say = (line: string) => transcript.push(line);

async function renderPublic(token: string): Promise<string> {
  const element = await PublicProposalPage({ params: Promise.resolve({ public_token: token }) });
  return renderToStaticMarkup(element);
}

const post = (action: string) =>
  respond(new Request("http://localhost/api/proposal/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "demo-token", action }),
  }));

const eventTypes = () => (db.tables.events ?? []).map((e) => String(e.type));

beforeEach(() => { llm.mode = "ok"; db.tables = {}; transcript.length = 0; });

describe("M1 local demo (DEMO.md steps 4–7 + client response)", () => {
  it("walks brief → proposal → send → public page → client accepts", async () => {
    // Шаг 4: клиент прошёл бриф — пайплайн rules + (замоканный) LLM.
    const { passport, cards, llmOk } = await runRiskPipeline(answers);
    say(`1. Бриф: ${passport.object.area_m2} м², срочность=${passport.timeline.urgency}; LLM ok=${llmOk}`);
    for (const c of cards) say(`   · риск [${c.source}/${c.risk_type}] ${c.designer_action}`);

    // Шаг 5: дизайнер принимает все карточки.
    const accepted = cards.map((c, i) => ({ ...c, id: `card-${i}`, status: "accepted" as const }));

    // Шаг 6: сборка КП — цена детерминирована, целые рубли.
    const recommendation = derivePackageRecommendation({ passport, answers, riskCards: accepted });
    const price = calcPrice(pricing, {
      area_m2: passport.object.area_m2!,
      complexity: "mid",
      urgent: passport.timeline.urgency === "urgent",
      package: recommendation.package_key,
    });
    const sections = buildProposalSections({
      passport, acceptedCards: accepted, defaults, price,
      packageChoice: recommendation.package_key, packageRecommendation: recommendation,
    });
    say(`2. КП: пакет=${recommendation.package_key}, цена ${price.range[0]}–${price.range[1]} ₽, секций ${sections.length}`);
    expect(Number.isSafeInteger(price.range[0]) && price.range[0] < price.range[1]).toBe(true);

    db.tables = {
      proposals: [{ id: "proposal-1", project_id: "project-1", version: 1, status: "draft", public_token: "demo-token", sections }],
      projects: [{ id: "project-1", designer_id: "designer-1", client_name: "Демо-клиент", status: "proposal_draft" }],
      events: [],
    };

    // Черновик по публичной ссылке не открывается (notFound).
    await expect(renderPublic("demo-token")).rejects.toThrow();
    say("3. Черновик по /p/demo-token → 404 (клиент не видит до «Отправить»)");

    // Шаг 7: «Отправить».
    expect(await sendProposal("project-1")).toEqual({ ok: true });
    expect(eventTypes()).toContain("proposal_sent");
    say("4. «Отправить» → proposals.status=sent, событие proposal_sent");

    // Клиент открывает /p/<token>: секции, цена, три кнопки ответа.
    const html = await renderPublic("demo-token");
    expect(html).toContain("Демо-клиент");
    for (const s of sections) expect(html).toContain(s.title);
    expect(html).toContain(price.range[0].toLocaleString("ru-RU"));
    for (const label of [ru.landing.respond.accept, ru.landing.respond.discuss, ru.landing.respond.changes]) {
      expect(html).toContain(label);
    }
    expect(eventTypes().filter((t) => t === "proposal_viewed")).toHaveLength(1);
    say(`5. Клиент открыл /p/demo-token: ${sections.length} секций, цена видна, кнопки «${ru.landing.respond.accept}» / «${ru.landing.respond.discuss}» / «${ru.landing.respond.changes}»; событие proposal_viewed`);

    // Клиент нажимает «Принять предложение».
    expect(await (await post("accept")).json()).toEqual({ ok: true, response: "proposal_accepted" });
    expect(db.tables.proposals?.[0]?.status).toBe("accepted");
    expect(db.tables.projects?.[0]?.status).toBe("proposal_accepted");
    say("6. Клиент: «Принять» → proposals.status=accepted, projects.status=proposal_accepted");

    // Повторное открытие: решение показано, повторный просмотр не пишется.
    const after = await renderPublic("demo-token");
    expect(after).toContain(ru.landing.respond.already.accepted);
    expect(eventTypes().filter((t) => t === "proposal_viewed")).toHaveLength(1);
    say(`7. Повторное открытие: «${ru.landing.respond.already.accepted}»`);
    say(`   события: ${eventTypes().join(" → ")}`);

    if (process.env.M1_DEMO_PRINT) process.stdout.write(`\nM1 local demo\n${transcript.join("\n")}\n\n`);
  });
});
