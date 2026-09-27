import { beforeEach, describe, expect, it, vi } from "vitest";

// DEC-044 (a): в срок удаления аккаунта КП открывается, но ответить на него
// нельзя; экспорт отдаёт только данные самого дизайнера без токенов доступа;
// отмена удаления передаёт причину отказа базы.

const state = vi.hoisted(() => ({
  inRetention: true,
  events: [] as Record<string, unknown>[],
  user: { id: "designer-1" } as { id: string } | null,
  cancelError: null as { message: string } | null,
  tables: {} as Record<string, Record<string, unknown>[]>,
  filters: [] as string[],
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true, clientIp: () => "test" }));

vi.mock("@/lib/supabase/token-scoped", () => ({
  createScopedServiceClient: () => ({
    rpc: async (name: string) => (name === "account_retention_active"
      ? { data: state.inRetention, error: null }
      : { data: null, error: null }),
    from: (table: string) => {
      const result = () => ({
        data: table === "proposals" ? { id: "proposal-1", project_id: "project-1", status: "sent" }
          : table === "projects" ? { designer_id: "designer-1", status: "proposal_sent" }
            : [],
        error: null,
      });
      const query = {
        select: () => query, eq: () => query, in: () => query, order: () => query, limit: () => query,
        maybeSingle: () => query, update: () => query,
        insert: (row: Record<string, unknown>) => { state.events.push(row); return query; },
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (name: string) => {
      if (name === "cancel_account_deletion") {
        return state.cancelError ? { data: null, error: state.cancelError } : { data: { status: "cancelled" }, error: null };
      }
      if (name === "export_passport_revisions") {
        return { data: [{ project_id: "project-1", revision_no: 1, passport: { contact: "x" } }], error: null };
      }
      if (name === "get_account_retention_status") return { data: null, error: null };
      return { data: null, error: null };
    },
    from: (table: string) => {
      let filter = "";
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { filter = `${column}=${String(value)}`; state.filters.push(`${table}:${filter}`); return query; },
        in: (column: string, values: unknown[]) => { filter = `${column} in ${values.join("|")}`; state.filters.push(`${table}:${filter}`); return query; },
        maybeSingle: () => query,
        range: () => query,
        is: () => query,
        then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve({
          data: table === "designers" ? { id: "designer-1", name: "Студия" } : state.tables[table] ?? [],
          error: null,
        }).then(resolve),
      };
      return query;
    },
  }),
}));

import { POST as respond } from "../../app/api/proposal/respond/route";
import { GET as exportAccount } from "../../app/api/account/export/route";
import { POST as cancelRetention } from "../../app/api/account/retention/route";

beforeEach(() => {
  state.inRetention = true;
  state.events = [];
  state.user = { id: "designer-1" };
  state.cancelError = null;
  state.filters = [];
  state.tables = {
    projects: [{ id: "project-1", designer_id: "designer-1", intake_token: "secret-intake", client_name: "Клиент" }],
    proposals: [{ id: "proposal-1", project_id: "project-1", version: 1, public_token: "secret-link", status: "sent" }],
    answers: [{ project_id: "project-1", question_id: "object", value: "flat" }],
    project_rooms: [{ id: "room-1", project_id: "project-1" }],
    project_participants: [{ id: "participant-1", room_id: "room-1", access_token: "secret-room" }],
  };
});

describe("client response while the designer account is in retention", () => {
  it("refuses with proposal_archived and records no response event", async () => {
    const response = await respond(new Request("https://example.test/api/proposal/respond", {
      method: "POST",
      body: JSON.stringify({ token: "token", action: "accept" }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "proposal_archived" });
    expect(state.events).toEqual([]);
  });
});

describe("full account export", () => {
  it("returns the designer's own projects with nested data and without access tokens", async () => {
    const response = await exportAccount();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    const body = JSON.parse(await response.text());
    expect(body.exportVersion).toBe("remhaos-account-export/2");
    expect(body.projects).toHaveLength(1);
    const [project] = body.projects;
    expect(project.intake_token).toBeUndefined();
    expect(project.proposals[0].public_token).toBeUndefined();
    expect(project.answers).toEqual([{ project_id: "project-1", question_id: "object", value: "flat" }]);
    expect(project.passportRevisions).toHaveLength(1);
    expect(project.rooms).toEqual([{ id: "room-1", project_id: "project-1" }]);
    expect(project.participants).toEqual([{ id: "participant-1", room_id: "room-1" }]);
    expect(state.filters).toContain("projects:designer_id=designer-1");
  });

  it("rejects unauthenticated export", async () => {
    state.user = null;
    expect((await exportAccount()).status).toBe(401);
  });
});

describe("cancel account deletion", () => {
  it("maps a legal hold refusal to a stable reason", async () => {
    state.cancelError = { message: "ACCOUNT_RETENTION_LEGAL_HOLD" };
    const response = await cancelRetention();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "legal_hold" });
  });

  it("cancels an active request", async () => {
    const response = await cancelRetention();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, retention: { status: "cancelled" } });
  });
});
