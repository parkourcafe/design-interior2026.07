import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  contractorPassport,
  contractorProposalSections,
  fileEntry,
  finalFiles,
  handoverBlockers,
  initialDraftFiles,
  kitFileSources,
  mergeDraftFiles,
  normalizeContractorSections,
  sameSnapshot,
  sha256Hex,
  snapshotEntry,
  snapshotMatches,
  type DraftFile,
} from "@/lib/project-room/handover";
import { findSensitive, sensitiveReasons, unresolvedFlags } from "@/lib/project-room/sensitive";
import { applyCorrection, parseCorrectionValue, readCorrectionField } from "@/lib/project-room/passport-correction";
import type { AnswersMap, Passport, ProposalSection } from "@/lib/types";

// Комплект подрядчика уровня 1 (решение владельца 01.10.2026, вариант B;
// сверка и подготовка — 02.10.2026, B-1/B-2): текст для исполнителя готовит
// дизайнер (автоматически убирается только секция «Стоимость»), подсветка
// подозрительных строк блокирует подтверждение до решения по каждой, файлы
// по умолчанию не передаются; manifest с SHA-256 переданных версий;
// «Получил» — один раз, только исполнитель.

const sections: ProposalSection[] = [
  { id: "task", title: "Задача клиента", body: "Объект: квартира, 64 м², Казань." },
  { id: "price", title: "Стоимость", body: "Диапазон стоимости: от 233 000 до 285 000 ₽." },
  { id: "stages", title: "Этапы и сроки", body: "1. Бриф\nАванс 50 000 руб. при старте\nОриентировочный срок: 14–18 недель." },
  { id: "included", title: "Что входит", body: "Бюджет 2,5 млн ₽ на комплектацию" },
];

const passport = {
  object: { type: "flat", area_m2: 64, city: "Казань" },
  asset_horizon: "self_long",
  household: { now: "с детьми", in_5y: "дети", kids: true, pets: false, decision_makers: "single" },
  lifestyle: { morning_load: "low", bathrooms: 1, cooking: "none", storage_pressure: "mid" },
  budget: { range: [500_000, 1_500_000], risk_level: "low", includes_furniture: "yes" },
  timeline: { target: "гибкие сроки", urgency: "normal" },
  style: { refs: [], anti: [], notes: "" },
  pain_points: "мало хранения",
  contact: { name: "Клиент", phone: "+7 900 000-00-00", email: "c@example.test" },
  source: "recommendation",
  scope: { package: "full" },
} as unknown as Passport;

describe("contractor kit content", () => {
  it("drops only the price section; money lines stay for the designer to see and remove", () => {
    const out = contractorProposalSections(sections);
    expect(out.map((s) => s.id)).toEqual(["task", "stages", "included"]);
    // Фильтр по «₽/руб» больше не считается защитой: строки остаются и подсвечиваются.
    expect(out.find((s) => s.id === "stages")?.body).toContain("Аванс 50 000 руб.");
    expect(normalizeContractorSections([{ id: "a", title: " A ", body: "  \r\n " }, { id: "b", title: "B", body: "x\r\ny" }]))
      .toEqual([{ id: "b", title: "B", body: "x\ny" }]);
  });

  it("keeps the object and drops contacts, budget, source and family plans from the passport", () => {
    const out = contractorPassport(passport);
    expect(out.object).toEqual(passport.object);
    expect(out.contact).toBeUndefined();
    expect(out.source).toBeUndefined();
    expect(out.budget.range).toBe("undisclosed");
    expect(out.pain_points).toBe("");
    expect(out.household).toEqual({ now: "", in_5y: "", kids: true, pets: false });
    expect(JSON.stringify(out)).not.toMatch(/900 000|example\.test|1500000|500000/);
  });

  it("takes only this project's designer plans and client files, without duplicates", () => {
    const answers = {
      designer_plan_attachments: [
        { path: "designer-plans/p1/1-plan.pdf", name: "plan.pdf", size: 10, type: "application/pdf" },
        { path: "designer-plans/other/1-x.pdf", name: "x.pdf" },
        { path: "designer-plans/p1/../../etc", name: "bad" },
      ],
      attachments: [
        { path: "p1/2-photo.jpg", name: "photo.jpg", size: 5, type: "image/jpeg" },
        { path: "p1/2-photo.jpg", name: "photo-dup.jpg" },
        { path: "p2/3-alien.jpg", name: "alien.jpg" },
      ],
    } as unknown as AnswersMap;
    expect(kitFileSources(answers, "p1")).toEqual([
      { kind: "designer_plan", name: "plan.pdf", path: "designer-plans/p1/1-plan.pdf", size: 10, contentType: "application/pdf" },
      { kind: "client_file", name: "photo.jpg", path: "p1/2-photo.jpg", size: 5, contentType: "image/jpeg" },
    ]);
  });

  it("hashes files and snapshots so the contractor page can detect tampering", () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 synthetic");
    const entry = fileEntry({ kind: "designer_plan", variant: "original", name: "plan.pdf", path: "designer-plans/p1/plan.pdf", size: null, contentType: null, sourceName: "plan.pdf" }, bytes);
    expect(entry).toMatchObject({ sha256: sha256Hex(bytes), size: bytes.byteLength, bucket: "client-uploads", path: "designer-plans/p1/plan.pdf", variant: "original" });
    expect(entry.sourceName).toBeUndefined();
    const copy = fileEntry({ kind: "client_file", variant: "safe_copy", name: "plan-safe.pdf", path: "designer-plans/p1/handover/1-plan-safe.pdf", size: 1, contentType: "application/pdf", sourceName: "plan.pdf" }, bytes);
    expect(copy).toMatchObject({ variant: "safe_copy", sourceName: "plan.pdf", path: "designer-plans/p1/handover/1-plan-safe.pdf" });

    const kitSections = contractorProposalSections(sections);
    const proposalEntry = snapshotEntry("proposal", "КП", kitSections, 2);
    expect(proposalEntry.version).toBe(2);
    expect(snapshotMatches(proposalEntry, kitSections)).toBe(true);
    expect(snapshotMatches(proposalEntry, [{ ...kitSections[0]!, body: "изменено" }])).toBe(false);
    // Порядок ключей не влияет на хеш (jsonb в базе ключи переупорядочивает).
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
});

describe("sensitive line highlighting (hint, not a guarantee)", () => {
  it("flags phones, emails, amounts in any notation and budget words", () => {
    expect(sensitiveReasons("Связь с клиентом: +7 900 000-00-00, client-rv@example.test")).toEqual(["phone", "email"]);
    expect(sensitiveReasons("Бюджет клиента 4,5 млн без мебели")).toEqual(["money", "budget"]);
    expect(sensitiveReasons("Бюджет 4 500 000 ₽")).toEqual(["money", "budget"]);
    expect(sensitiveReasons("около 300 тыс. на кухню")).toEqual(["money"]);
    expect(sensitiveReasons("Цена вопроса")).toEqual(["budget"]);
    expect(sensitiveReasons("смета на электрику")).toEqual(["budget"]);
  });

  it("leaves ordinary scope lines alone", () => {
    for (const line of ["Ориентировочный срок: 14–18 недель.", "Объект: квартира, 64 м², Казань.", "Санузлов: 1", "2 кухни, 3 комнаты", "Планировочное решение с расстановкой мебели", "Этап 2026-12-08"]) {
      expect(sensitiveReasons(line)).toEqual([]);
    }
  });

  it("scans the contractor text and the passport summary; acknowledgement is per line", () => {
    const flags = findSensitive(
      [{ id: "works", title: "Состав работ", body: "— Перенос кухни\n— Бюджет клиента 4,5 млн без мебели" }],
      { ...contractorPassport(passport), style: { refs: [], anti: [], notes: "звонить по +7 911 111-11-11" } } as Passport,
    );
    expect(flags.map((f) => f.where)).toEqual(["section:works", "passport:style.notes"]);
    expect(flags[0]!.line).toBe("— Бюджет клиента 4,5 млн без мебели");
    expect(unresolvedFlags(flags, [flags[0]!.id]).map((f) => f.where)).toEqual(["passport:style.notes"]);
    // Изменённая строка — новая подсветка: старая отметка «оставить» на неё не действует.
    const edited = findSensitive([{ id: "works", title: "Состав работ", body: "— Бюджет клиента 5 млн" }], null);
    expect(unresolvedFlags(edited, [flags[0]!.id])).toHaveLength(1);
  });
});

describe("file decisions and readiness", () => {
  const sources = kitFileSources({
    designer_plan_attachments: [{ path: "designer-plans/p1/1-plan.pdf", name: "plan.pdf", size: 10, type: "application/pdf" }],
    attachments: [{ path: "p1/2-photo.pdf", name: "photo.pdf", size: 5, type: "application/pdf" }],
  } as unknown as AnswersMap, "p1");

  it("starts with every project file excluded", () => {
    const files = initialDraftFiles(sources);
    expect(files.map((f) => f.decision)).toEqual(["exclude", "exclude"]);
    expect(finalFiles(files)).toEqual([]);
  });

  it("keeps saved decisions, adds new files as excluded and drops vanished ones", () => {
    const saved: DraftFile[] = [
      { ...initialDraftFiles(sources)[0]!, decision: "original", reviewed: true },
      { kind: "client_file", source_path: "p1/gone.pdf", name: "gone.pdf", size: 1, content_type: null, decision: "original", reviewed: true },
    ];
    const merged = mergeDraftFiles(saved, sources);
    expect(merged.map((f) => [f.name, f.decision, f.reviewed])).toEqual([["plan.pdf", "original", true], ["photo.pdf", "exclude", false]]);
  });

  it("final files are exactly the chosen originals and safe copies", () => {
    const [plan, photo] = initialDraftFiles(sources);
    const files: DraftFile[] = [
      { ...plan!, decision: "original", reviewed: true },
      { ...photo!, decision: "safe_copy", reviewed: true, safe_copy: { path: "designer-plans/p1/handover/3-photo-safe.pdf", name: "photo-safe.pdf", size: 4, content_type: "application/pdf" } },
    ];
    expect(finalFiles(files)).toEqual([
      { kind: "designer_plan", variant: "original", name: "plan.pdf", path: "designer-plans/p1/1-plan.pdf", size: 10, contentType: "application/pdf", sourceName: "plan.pdf" },
      { kind: "client_file", variant: "safe_copy", name: "photo-safe.pdf", path: "designer-plans/p1/handover/3-photo-safe.pdf", size: 4, contentType: "application/pdf", sourceName: "photo.pdf" },
    ]);
  });

  it("blocks confirmation on unresolved highlights, missing safe copies and unreviewed files", () => {
    const [plan, photo] = initialDraftFiles(sources);
    const text = [{ id: "task", title: "Задача", body: "квартира" }];
    expect(handoverBlockers({ sections: text, files: [plan!, photo!], unresolvedFlagCount: 0 })).toEqual([]);
    expect(handoverBlockers({
      sections: [],
      files: [{ ...plan!, decision: "needs_safe_copy" }, { ...photo!, decision: "original", reviewed: false }],
      unresolvedFlagCount: 2,
    })).toEqual([
      { code: "text_empty" },
      { code: "flags_unresolved", count: 2 },
      { code: "needs_safe_copy", names: ["plan.pdf"] },
      { code: "not_reviewed", names: ["photo.pdf"] },
    ]);
  });
});

describe("passport correction", () => {
  it("validates values and changes exactly one field", () => {
    const base = { ...passport, object: { ...passport.object, replanning: "no" } } as Passport;
    expect(parseCorrectionValue("object.replanning", "yes")).toBe("yes");
    expect(parseCorrectionValue("object.replanning", "sure")).toBeNull();
    expect(parseCorrectionValue("object.area_m2", "64,5")).toBe(64.5);
    expect(parseCorrectionValue("lifestyle.bathrooms", "1.5")).toBeNull();
    expect(parseCorrectionValue("style.notes", "x".repeat(2001))).toBeNull();
    const next = applyCorrection(base, "object.replanning", "yes");
    expect(readCorrectionField(next, "object.replanning")).toBe("yes");
    expect({ ...next, object: { ...next.object, replanning: "no" } }).toEqual(base);
    expect(sameSnapshot(next, base)).toBe(false);
    expect(sameSnapshot(applyCorrection(base, "object.replanning", "no"), base)).toBe(true);
  });
});

// ── «Получил комплект» ────────────────────────────────────────────────────
const db = vi.hoisted(() => ({
  participants: [] as Array<Record<string, unknown>>,
  kits: [] as Array<Record<string, unknown>>,
  receipts: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  closed: false,
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true, clientIp: () => "test" }));
vi.mock("@/lib/project-room/closed", () => ({ isRoomClosed: async () => db.closed }));
vi.mock("@/lib/supabase/token-scoped", () => ({
  createScopedServiceClient: () => ({
    from(table: string) {
      const source = table === "project_participants" ? db.participants
        : table === "project_handover_kits" ? db.kits
          : table === "project_handover_receipts" ? db.receipts
            : db.events;
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      let inserted: Record<string, unknown> | null = null;
      let error: { code: string } | null = null;
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
        maybeSingle: () => Promise.resolve({ data: source.find((r) => filters.every((f) => f(r))) ?? null, error: null }),
        insert: (row: Record<string, unknown>) => {
          if (table === "project_handover_receipts"
            && db.receipts.some((r) => r.kit_id === row.kit_id && r.participant_id === row.participant_id)) {
            error = { code: "23505" };
          } else {
            inserted = { ...row, received_at: "2026-10-01T18:00:00.000Z" };
            source.push(inserted);
          }
          return Promise.resolve({ data: inserted, error });
        },
      };
      return q;
    },
  }),
}));

import { POST as receive } from "@/app/api/project-room/kit-receipt/route";

const post = (token: string) => receive(new Request("http://localhost/api/project-room/kit-receipt", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token }),
}));

beforeEach(() => {
  db.participants = [
    { id: "exec-1", room_id: "room-1", role: "executor", access_token: "executor-token-123456" },
    { id: "client-1", room_id: "room-1", role: "client", access_token: "client-token-1234567" },
  ];
  db.kits = [{ id: "kit-1", room_id: "room-1", proposal_version: 2 }];
  db.receipts = [];
  db.events = [];
  db.closed = false;
});

describe("contractor receipt", () => {
  it("records one receipt for the executor; a repeat returns the same mark", async () => {
    const first = await post("executor-token-123456");
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, receivedAt: "2026-10-01T18:00:00.000Z", replay: false });
    const again = await post("executor-token-123456");
    expect(await again.json()).toEqual({ ok: true, receivedAt: "2026-10-01T18:00:00.000Z", replay: true });
    expect(db.receipts).toHaveLength(1);
    expect(db.events.filter((e) => e.event_type === "handover_kit_received")).toHaveLength(1);
  });

  it("refuses other roles, unknown tokens and closed rooms", async () => {
    expect((await post("client-token-1234567")).status).toBe(403);
    expect((await post("unknown-token-123456")).status).toBe(404);
    db.closed = true;
    expect((await post("executor-token-123456")).status).toBe(410);
    expect(db.receipts).toEqual([]);
  });

  it("answers 404 when nothing was handed over yet", async () => {
    db.kits = [];
    expect((await post("executor-token-123456")).status).toBe(404);
  });
});
