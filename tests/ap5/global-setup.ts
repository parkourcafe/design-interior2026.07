import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";

import {
  AP5_INVITED_ROLES,
  AP5_ROLES,
  ap5Env,
  statePath,
  storageStatePath,
  writeHandoff,
  type Ap5RoleKey,
} from "./ap5-env";

const env = ap5Env();

async function waitForApp(): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      const response = await fetch(`${env.appUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // приложение ещё поднимается
    }
    if (Date.now() > deadline) throw new Error("AP5: приложение не поднялось за 120 с");
    await new Promise((done) => setTimeout(done, 500));
  }
}

/**
 * Главная защита гейта. `PROJECTCEO_LOCAL_FIXTURE_MODE=1` подменяет живой порт
 * моками — и тогда весь browser matrix «зелёный», ничего не доказав. Мок-порт
 * отвечает на портфель данными; настоящий без сессии обязан ответить 401.
 */
async function assertLiveStackNotFixtures(): Promise<void> {
  if (process.env.PROJECTCEO_LOCAL_FIXTURE_MODE === "1") {
    throw new Error("AP5: PROJECTCEO_LOCAL_FIXTURE_MODE=1 — гейт доказывал бы моки");
  }
  const response = await fetch(`${env.appUrl}/api/projectceo/portfolio`);
  if (response.status !== 401) {
    throw new Error(
      `AP5: портфель без сессии вернул ${response.status}, ожидался 401. `
      + "Похоже, приложение запущено на фикстурах, а не на живом стеке.",
    );
  }
}

/** Настоящая пользовательская сессия, а не service role. */
async function signIn(role: Ap5RoleKey) {
  const client = createClient(env.supabaseUrl, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: env.emailFor(role),
    password: env.password,
  });
  if (error || !data.session || !data.user) {
    throw new Error(`AP5: ${role} не смог войти: ${error?.message ?? "нет сессии"}`);
  }
  return { accessToken: data.session.access_token, userId: data.user.id };
}

/**
 * Регистрация организации и проекта.
 *
 * ⚠️ Известное отступление, зафиксированное в AP5_RUNBOOK.md: у
 * `enroll_organization_project` сегодня нет HTTP-поверхности — ни маршрута, ни
 * элемента интерфейса, `FoundationService` никуда не подключён. Поэтому шаг
 * выполняется RPC от лица owner ЕГО ЖЕ access token — инвариант «human
 * operations не выполняются через service role» соблюдён, но браузерным
 * доказательством этот шаг не является.
 */
async function enroll(ownerToken: string, projectId: string): Promise<void> {
  const client = createClient(env.supabaseUrl, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${ownerToken}` } },
  });
  const { error } = await client
    .schema("projectceo_api")
    .rpc("enroll_organization_project", {
      project_id: projectId,
      idempotency_key: `ap5-enroll-${projectId}`,
    });
  if (error) throw new Error(`AP5: enroll_organization_project отказал: ${error.message}`);
}

/** Вход через настоящую форму — сессия рождается в браузере, а не подкладывается. */
async function captureBrowserSession(role: Ap5RoleKey): Promise<void> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: env.appUrl });
    const page = await context.newPage();
    await page.goto("/login");
    await page.locator("#email").fill(env.emailFor(role));
    await page.locator("#password").fill(env.password);
    await page.locator("form").filter({ has: page.locator("#password") })
      .locator("button[type=submit]").click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
    await context.storageState({ path: storageStatePath(role) });
    await context.close();
  } finally {
    await browser.close();
  }
}

/** Приглашение выпускает owner своей сессией; ссылку возвращает сама команда. */
async function createInvitation(
  projectId: string,
  targetRole: string,
  recipientEmail: string,
): Promise<string> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: env.appUrl,
      storageState: storageStatePath("owner"),
    });
    const response = await context.request.post("/api/projectceo/commands", {
      headers: { Origin: env.appUrl, "Content-Type": "application/json" },
      data: {
        contractVersion: "projectceo-command/0.1",
        kind: "create_invitation",
        projectId,
        commandId: randomUUID(),
        payload: {
          recipientEmail,
          targetRole,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      },
    });
    const body = await response.json();
    const invitationUrl = body?.data?.invitationUrl;
    if (!response.ok() || typeof invitationUrl !== "string") {
      throw new Error(
        `AP5: create_invitation для ${targetRole} отказал: `
        + `${response.status()} ${JSON.stringify(body?.error ?? body)}`,
      );
    }
    await context.close();
    return invitationUrl;
  } finally {
    await browser.close();
  }
}

/** Приём приглашения — уже настоящий браузерный шаг, своей сессией приглашённого. */
async function acceptInvitation(role: Ap5RoleKey, invitationUrl: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: env.appUrl,
      storageState: storageStatePath(role),
    });
    const page = await context.newPage();
    await page.goto(invitationUrl);
    await page.locator("main button[type=button]").first().click();
    // Страница не уходит на другой маршрут: при успехе она подменяет кнопку
    // блоком со ссылкой в рабочее пространство. Ждём именно ссылку — по href,
    // чтобы селектор не зависел от текста.
    await page.locator('a[href="/dashboard/projectceo"]').waitFor({ timeout: 30_000 });
    await context.storageState({ path: storageStatePath(role) });
    await context.close();
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(): Promise<void> {
  rmSync(statePath("."), { recursive: true, force: true });
  mkdirSync(statePath("."), { recursive: true });

  await waitForApp();
  await assertLiveStackNotFixtures();

  const projectId = randomUUID();
  const userIds: Record<string, string> = {};

  const owner = await signIn("owner");
  userIds.owner = owner.userId;
  await enroll(owner.accessToken, projectId);

  for (const role of AP5_ROLES) {
    if (role.key !== "owner") userIds[role.key] = (await signIn(role.key)).userId;
    await captureBrowserSession(role.key);
  }

  for (const role of AP5_INVITED_ROLES) {
    const invitationUrl = await createInvitation(
      projectId,
      role.targetRole,
      env.emailFor(role.key),
    );
    await acceptInvitation(role.key, invitationUrl);
  }

  writeHandoff({ projectId, rootPackageId: projectId, userIds });
}
