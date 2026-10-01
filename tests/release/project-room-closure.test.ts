// DEC-047 (g), решение владельца 01.10.2026: комната проекта закрывается сразу
// после запроса удаления аккаунта студии. Участник по ссылке не видит задач и
// не меняет их; не удалось проверить — закрыто.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  retention: { data: false as unknown, error: null as unknown },
  updates: 0,
}));

function chain(table: string) {
  const rows: Record<string, unknown> = {
    project_participants: { id: "p-1", room_id: "room-1", role: "client", display_name: "Ирина Клиентова" },
    project_rooms: { project_id: "project-1" },
    project_tasks: { id: "11111111-1111-4111-8111-111111111111", room_id: "room-1", title: "Согласовать планировку",
      description: "", owner_role: "client", assignee_participant_id: "p-1", due_date: null, status: "todo",
      client_facing: true, related_scope_item: null, proposal_section: null, created_from: "manual", sort_order: 1 },
  };
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.order = async () => ({ data: [rows.project_tasks], error: null });
  q.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
  q.update = () => { state.updates += 1; return { eq: async () => ({ error: null }) }; };
  q.insert = async () => ({ error: null });
  return q;
}

vi.mock("@/lib/supabase/token-scoped", () => ({
  createScopedServiceClient: () => ({
    from: (table: string) => chain(table),
    rpc: async () => state.retention,
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true, clientIp: () => "127.0.0.1" }));

const { default: RoomPage } = await import("@/app/room/[access_token]/page");
const { POST } = await import("@/app/api/project-room/task-status/route");

async function page() {
  return renderToStaticMarkup(await RoomPage({ params: Promise.resolve({ access_token: "t".repeat(24) }) }));
}
function statusRequest() {
  return new Request("http://localhost/api/project-room/task-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t".repeat(24), taskId: "11111111-1111-4111-8111-111111111111", status: "done" }),
  });
}

describe("project room after an account deletion request", () => {
  beforeEach(() => {
    state.retention = { data: false, error: null };
    state.updates = 0;
  });

  it("works as before while the studio account is open", async () => {
    const html = await page();
    expect(html).toContain("Согласовать планировку");
    expect(html).not.toContain("Комната закрыта");
    expect((await POST(statusRequest())).status).toBe(200);
    expect(state.updates).toBe(1);
  });

  it("closes the page and the status change right after the request", async () => {
    state.retention = { data: true, error: null };
    const html = await page();
    expect(html).toContain("Комната закрыта");
    expect(html).not.toContain("Согласовать планировку");
    expect(html).not.toContain("Ирина Клиентова");
    const response = await POST(statusRequest());
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "room_closed" });
    expect(state.updates).toBe(0);
  });

  it("stays closed when the check itself fails", async () => {
    state.retention = { data: null, error: { message: "boom" } };
    expect(await page()).toContain("Комната закрыта");
    expect((await POST(statusRequest())).status).toBe(410);
    expect(state.updates).toBe(0);
  });
});
