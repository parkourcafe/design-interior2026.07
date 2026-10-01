import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  contractorPassport,
  contractorProposalSections,
  fileEntry,
  kitFileSources,
  sha256Hex,
  snapshotEntry,
  snapshotMatches,
} from "@/lib/project-room/handover";
import type { AnswersMap, Passport, ProposalSection } from "@/lib/types";

// Комплект подрядчика уровня 1 (решение владельца 01.10.2026, вариант B):
// без сумм, без контактов и бюджета клиента, только файлы своего проекта,
// manifest с SHA-256; «Получил» — один раз, только исполнитель.

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
  it("drops the price section and every line with a ruble amount", () => {
    const out = contractorProposalSections(sections);
    expect(out.map((s) => s.id)).toEqual(["task", "stages"]);
    expect(JSON.stringify(out)).not.toMatch(/₽|руб/);
    expect(out.find((s) => s.id === "stages")?.body).toBe("1. Бриф\nОриентировочный срок: 14–18 недель.");
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
    const entry = fileEntry({ kind: "designer_plan", name: "plan.pdf", path: "designer-plans/p1/plan.pdf", size: null, contentType: null }, bytes);
    expect(entry).toMatchObject({ sha256: sha256Hex(bytes), size: bytes.byteLength, bucket: "client-uploads", path: "designer-plans/p1/plan.pdf" });

    const kitSections = contractorProposalSections(sections);
    const proposalEntry = snapshotEntry("proposal", "КП", kitSections, 2);
    expect(proposalEntry.version).toBe(2);
    expect(snapshotMatches(proposalEntry, kitSections)).toBe(true);
    expect(snapshotMatches(proposalEntry, [{ ...kitSections[0]!, body: "изменено" }])).toBe(false);
    // Порядок ключей не влияет на хеш (jsonb в базе ключи переупорядочивает).
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
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
