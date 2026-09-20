import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = vi.hoisted(() => ({
  userId: "11111111-1111-4111-8111-111111111111",
  membership: "ambiguous" as "ambiguous" | "member",
  eventError: false,
  eventQueries: 0,
  filters: [] as Array<string | undefined>,
}));

vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/lib/designer", () => ({
  getOrCreateDesigner: async () => ({ id: fixture.userId, name: "Synthetic owner" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: fixture.userId, email: "fixture@example.test" } } }) },
    from(table: string) {
      let studioId: string | undefined;
      const query = {
        select() { return query; },
        eq(column: string, value: string) {
          if (column === "designer_id") studioId = value;
          return query;
        },
        order() { return query; },
        async maybeSingle() {
          if (table === "studio_members") return fixture.membership === "ambiguous"
            ? { data: null, error: { code: "PGRST116" } }
            : { data: { owner_id: "22222222-2222-4222-8222-222222222222" }, error: null };
          return { data: { id: "22222222-2222-4222-8222-222222222222" }, error: null };
        },
        async range(start: number, end: number) {
          if (table !== "events") throw new Error("Unexpected paginated table");
          fixture.eventQueries++;
          fixture.filters.push(studioId);
          if (fixture.eventError) return { data: null, error: { message: "private database marker" } };
          // RLS can expose events from multiple joined studios. The page must
          // constrain the selected owner's studio on every pagination request.
          const visible = Array.from({ length: 1004 }, (_, index) => ({
            designer_id: index < 1001 ? fixture.userId : "22222222-2222-4222-8222-222222222222",
            type: "intake_link_created",
            project_id: `synthetic-project-${index}`,
            created_at: "2026-09-12T00:00:00Z",
          }));
          const scoped = studioId ? visible.filter(event => event.designer_id === studioId) : visible;
          return { data: scoped.slice(start, end + 1), error: null };
        },
      };
      return query;
    },
  }),
}));

import AnalyticsPage from "../../app/dashboard/analytics/page";
import { getStudio } from "../../lib/studio";
import { ru } from "../../lib/i18n/ru";

describe("analytics selected-studio boundary", () => {
  beforeEach(() => {
    fixture.membership = "ambiguous";
    fixture.eventError = false;
    fixture.eventQueries = 0;
    fixture.filters = [];
  });

  it("keeps ambiguous membership fallback confined to the user's own events on every page", async () => {
    expect(await getStudio()).toMatchObject({ role: "owner", studioId: fixture.userId });
    const html = renderToStaticMarkup(await AnalyticsPage());
    expect(fixture.eventQueries).toBe(2);
    expect(fixture.filters).toEqual([fixture.userId, fixture.userId]);
    expect(html).toContain("1001");
    expect(html).not.toContain("1004");
  });

  it("rejects a selected member studio before loading analytics", async () => {
    fixture.membership = "member";
    await expect(AnalyticsPage()).rejects.toThrow("redirect");
    expect(fixture.eventQueries).toBe(0);
  });

  it("returns only a controlled error when the scoped query fails", async () => {
    fixture.eventError = true;
    const html = renderToStaticMarkup(await AnalyticsPage());
    expect(html).toContain(ru.analytics.loadError);
    expect(html).not.toContain("private database marker");
    expect(fixture.filters).toEqual([fixture.userId]);
  });
});
