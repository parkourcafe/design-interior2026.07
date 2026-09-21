import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  failure: "", rows: [] as Record<string, unknown>[], known: true, llmOk: true,
  projectStatus: "created", existingResponse: null as string | null,
}));
// WP-42B перевёл intake-роуты на региональный клиент, а он объявляет
// `import "server-only"`. В тестах этот модуль не резолвится (его даёт сборщик
// Next, не Node), поэтому заглушка обязательна — ровно так же, как в
// command-service.test.ts и остальных тестах, тянущих серверные модули.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/intake", () => ({ getProjectByIntakeToken: async () => state.known ? { id: "project", designer_id: "designer", status: state.projectStatus, cellCode: "ru" } : null }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true, clientIp: () => "test" }));
vi.mock("@/lib/brief/pipeline", () => ({ runRiskPipeline: async () => {
  if (state.failure === "pipeline") throw new Error("private submitted content");
  return { passport: {}, cards: [], llmOk: state.llmOk };
} }));
// Один и тот же поддельный клиент нужен двум модулям: intake-роуты ходят через
// региональный клиент (WP-42B), а proposal/respond остался на token-scoped.
const fakeClient = vi.hoisted(() => () => ({
  schema: () => ({ rpc: async () => ({ data: { requests: [{ subjectKind: "project_passport", subjectId: "project", status: "approved" }] }, error: null }) }),
  storage: { from: () => ({ upload: async () => ({ error: { message: "private filename" } }) }) },
  from: (table: string) => {
    let operation = "select";
    const result = () => ({ data: table === "proposals" ? { id: "proposal", project_id: "project", status: "sent" } : table === "projects" ? { designer_id: "designer", status: state.projectStatus } : table === "events" && operation === "select" && state.existingResponse ? [{ type: state.existingResponse }] : [], error: state.failure === `${table}:${operation}` ? { message: "private db details" } : null });
    const query = {
      select: () => query, eq: () => query, in: () => query, order: () => query, limit: () => query, maybeSingle: () => query,
      update: () => { operation = "update"; return query; },
      delete: () => { operation = "delete"; return query; },
      upsert: () => { operation = "upsert"; return query; },
      insert: (row: Record<string, unknown>) => { operation = "insert"; state.rows.push(row); return query; },
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  },
}));
vi.mock("@/lib/supabase/token-scoped", () => ({ createScopedServiceClient: fakeClient }));
vi.mock("@/lib/supabase/regional-admin", () => ({ createRegionalPublicTokenClient: fakeClient }));
import { POST as start } from "../../app/api/intake/start/route";
import { POST as submit } from "../../app/api/intake/submit/route";
import { POST as upload } from "../../app/api/intake/upload/route";
import { POST as respond } from "../../app/api/proposal/respond/route";
const request = () => new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "secret-token", action: "accept", answers: { private: "private content" } }) });
beforeEach(() => { state.failure = ""; state.rows = []; state.known = true; state.llmOk = true; state.projectStatus = "created"; state.existingResponse = null; });
describe("launch failure events", () => {
  it.each([["projects:update", start, "intake_start_failed"], ["answers:upsert", submit, "intake_submit_failed"], ["pipeline", submit, "intake_submit_failed"], ["events:select", respond, "proposal_respond_failed"]] as const)("records a scoped sanitized failure for %s", async (failure, route, type) => {
    state.failure = failure;
    const response = await route(request());
    expect(response.status).toBe(500);
    expect(state.rows).toContainEqual({ designer_id: "designer", project_id: "project", type });
    expect(JSON.stringify(state.rows)).not.toMatch(/private|secret-token/);
    expect(await response.text()).not.toContain("private");
  });
  it("does not attribute unknown-token errors to a project", async () => {
    state.known = false;
    expect((await submit(request())).status).toBe(404);
    expect(state.rows).toEqual([]);
  });
  it("records AI fallback separately from successful completion", async () => {
    state.llmOk = false;
    expect((await submit(request())).status).toBe(200);
    expect(state.rows.map((row) => row.type)).toEqual(["brief_completed", "intake_ai_fallback"]);
  });
  it("repairs a missing brief_started event after a partial status commit", async () => {
    state.projectStatus = "brief_in_progress";
    expect((await start(request())).status).toBe(200);
    expect(state.rows).toEqual([{ designer_id: "designer", project_id: "project", type: "brief_started" }]);
  });
  it("retries accepted proposal state after the first response partially committed", async () => {
    state.existingResponse = "proposal_accepted";
    state.projectStatus = "proposal_sent";
    state.failure = "projects:update";
    expect((await respond(request())).status).toBe(500);
    expect(state.rows).toContainEqual({ designer_id: "designer", project_id: "project", type: "proposal_respond_failed" });
    state.failure = "";
    expect((await respond(request())).status).toBe(200);
  });
  it("logs failed upload without exposing the filename", async () => {
    const form = new FormData(); form.set("token", "secret-token"); form.set("file", new File(["fixture"], "private.txt"));
    const response = await upload(new Request("http://localhost/api", { method: "POST", body: form }));
    expect(response.status).toBe(500);
    expect(state.rows).toEqual([{ designer_id: "designer", project_id: "project", type: "intake_upload_failed" }]);
    expect(await response.text()).not.toContain("private");
  });
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => {
  const { createScopedServiceClient } = await import("@/lib/supabase/token-scoped");
  return createScopedServiceClient("proposal-response");
} }));
vi.mock("@/lib/studio", () => ({ getStudio: async () => ({ studioId: "designer", designer: {} }) }));
vi.mock("@/lib/proposal/latest", () => ({ getLatestProposal: async () => ({ id: "proposal", status: "draft" }) }));
import { saveProposal, sendProposal } from "../../app/dashboard/projects/[id]/proposal/actions";

describe("request-bound proposal action errors", () => {
  it("records a save failure using the project's server-derived owner", async () => {
    state.failure = "proposals:update";
    expect(await saveProposal("project", [])).toEqual({ ok: false });
    expect(state.rows).toEqual([{ designer_id: "designer", project_id: "project", type: "proposal_save_failed" }]);
  });
  it("records a send failure without logging approval or proposal content", async () => {
    state.failure = "proposals:update";
    expect(await sendProposal("project")).toEqual({ ok: false });
    expect(state.rows).toEqual([{ designer_id: "designer", project_id: "project", type: "proposal_send_failed" }]);
  });
  it("does not report send success when the project transition fails", async () => {
    state.failure = "projects:update";
    expect(await sendProposal("project")).toEqual({ ok: false });
    expect(state.rows).toEqual([{ designer_id: "designer", project_id: "project", type: "proposal_send_failed" }]);
  });
});
