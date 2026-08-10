import { randomUUID } from "node:crypto";

import { expect, test, type APIResponse, type Browser } from "@playwright/test";

import { AP5_ROLES, ap5Env, readHandoff, storageStatePath, type Ap5RoleKey } from "./ap5-env";

const env = ap5Env();
// Ленивое чтение: сборка списка тестов не должна зависеть от того,
// отработал ли global-setup — иначе `playwright test --list` падает.
let cached: ReturnType<typeof readHandoff> | null = null;
function handoff() {
  cached ??= readHandoff();
  return cached;
}

async function asRole(browser: Browser, role: Ap5RoleKey) {
  return browser.newContext({
    baseURL: env.appUrl,
    storageState: storageStatePath(role),
  });
}

async function json(response: APIResponse): Promise<{
  readonly data?: { readonly actor?: { readonly role?: string; readonly capabilities?: readonly string[] } };
  readonly error?: { readonly code?: string };
}> {
  return await response.json();
}

test.describe("AP5 — browser matrix отдельной аутентифицированной сессией на роль", () => {
  // Первое, что должен доказать гейт: это живой стек. Мок-порт отдал бы
  // портфель без всякой сессии, и вся матрица ниже стала бы бессмысленной.
  test("портфель без сессии закрыт", async ({ request }) => {
    const response = await request.get(`${env.appUrl}/api/projectceo/portfolio`);
    expect(response.status()).toBe(401);
    expect((await json(response)).error?.code).toBe("unauthenticated");
  });

  for (const role of AP5_ROLES.filter((candidate) => candidate.membership !== null)) {
    test(`${role.key}: своя сессия видит проект в своей роли`, async ({ browser }) => {
      const context = await asRole(browser, role.key);
      const page = await context.newPage();

      // Страница — настоящая, серверно отрендеренная под этой сессией.
      const portfolio = await page.goto("/dashboard/projectceo");
      expect(portfolio?.status()).toBe(200);
      const workspace = await page.goto(`/dashboard/projectceo/projects/${handoff().projectId}`);
      expect(workspace?.status()).toBe(200);

      // Проекция — из того же контекста, чтобы утверждать про роль точно, а не
      // по тексту вёрстки.
      const api = await context.request.get(
        `/api/projectceo/projects/${handoff().projectId}`,
      );
      expect(api.status()).toBe(200);
      const body = await json(api);
      expect(body.data?.actor?.role).toBe(role.uiRole);
      expect(body.data?.actor?.capabilities).toContain("view_project");

      await context.close();
    });
  }

  test("guest без членства не получает проект", async ({ browser }) => {
    const context = await asRole(browser, "guest");
    const page = await context.newPage();

    const workspace = await page.goto(`/dashboard/projectceo/projects/${handoff().projectId}`);
    expect(workspace?.status()).toBe(404);

    const api = await context.request.get(`/api/projectceo/projects/${handoff().projectId}`);
    expect([403, 404]).toContain(api.status());

    await context.close();
  });

  test("чужой проект не открывается даже владельцу своего", async ({ browser }) => {
    const context = await asRole(browser, "owner");
    const api = await context.request.get(`/api/projectceo/projects/${randomUUID()}`);
    expect([403, 404]).toContain(api.status());
    await context.close();
  });

  test("роль приходит с сервера, а не из запроса клиента", async ({ browser }) => {
    const context = await asRole(browser, "builder");
    // Подсказки роли в запросе не должны ни на что влиять: проекция считается
    // от членства, а не от того, что прислал браузер.
    const api = await context.request.get(
      `/api/projectceo/projects/${handoff().projectId}?role=owner`,
      { headers: { "x-projectceo-role": "owner" } },
    );
    expect(api.status()).toBe(200);
    expect((await json(api)).data?.actor?.role).toBe("builder");
    await context.close();
  });

  test("мутация без same-origin отклоняется", async ({ browser }) => {
    const context = await asRole(browser, "owner");
    const response = await context.request.post("/api/projectceo/commands", {
      headers: { Origin: "https://attacker.invalid", "Content-Type": "application/json" },
      data: {
        contractVersion: "projectceo-command/0.1",
        kind: "create_invitation",
        projectId: handoff().projectId,
        commandId: randomUUID(),
        payload: {
          recipientEmail: env.emailFor("guest"),
          targetRole: "architect",
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      },
    });
    expect(response.status()).toBe(403);
    await context.close();
  });
});
