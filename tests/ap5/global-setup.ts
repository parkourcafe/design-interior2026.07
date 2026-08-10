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

/**
 * Вход по одноразовой ссылке, а не по паролю.
 *
 * Это не удобство, а требование контракта. `public.projectceo_custom_access_token_hook`
 * (миграции 20260801150000 и 20260802001000) выдаёт claim `email_verified`
 * ТОЛЬКО методам, доказывающим владение адресом — `otp`, `magiclink`, `invite`,
 * `email/signup`. Вход по паролю его не получает намеренно, и вся поверхность
 * ProjectCEO для такой сессии закрыта как `identity_unverified`. Именно на этом
 * останавливался приём приглашений.
 *
 * Ящика в стенде нет (`local_smtp` выключен в config.toml), поэтому письмо
 * заменяется выпуском ссылки через admin API. Service role здесь подменяет
 * доставку письма, а не выполняет операцию за человека: по ссылке ходит
 * браузер, и сессия рождается в нём.
 */
async function issueMagicLink(role: Ap5RoleKey) {
  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: env.emailFor(role),
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash || !data?.user) {
    throw new Error(`AP5: не выпустить ссылку для ${role}: ${error?.message ?? "нет токена"}`);
  }
  return { tokenHash, userId: data.user.id };
}

/** Ссылка ведёт в /auth/callback, который меняет token_hash на сессию. */
function callbackUrl(tokenHash: string, next = "/dashboard"): string {
  const url = new URL("/auth/callback", env.appUrl);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", "magiclink");
  url.searchParams.set("next", next);
  return url.toString();
}

/** Токен той же природы для RPC-шага: одноразовая ссылка тратится один раз. */
async function accessTokenFor(role: Ap5RoleKey): Promise<string> {
  const { tokenHash } = await issueMagicLink(role);
  const client = createClient(env.supabaseUrl, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (error || !data.session) {
    throw new Error(`AP5: ${role} не получил сессию: ${error?.message ?? "нет сессии"}`);
  }
  return data.session.access_token;
}

/**
 * Проект в браузере, штатной формой дизайнера на `/dashboard`.
 *
 * `enroll_organization_project` НЕ создаёт проект: он берёт уже существующую
 * строку `public.projects` и требует, чтобы её `designer_id` совпадал с
 * актором (миграция 20260717090000, ветка P1104 `not_found`). Придуманный
 * UUID тут не годится — именно на этом прогон 09:04 и остановился.
 */
async function createLegacyProject(): Promise<string> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: env.appUrl,
      storageState: storageStatePath("owner"),
    });
    const page = await context.newPage();
    await page.goto("/dashboard");
    await page.locator("#client").fill("AP5 Kora");
    await page.locator("form button[type=submit]").first().click();
    await page.waitForURL(/\/dashboard\/projects\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const projectId = new URL(page.url()).pathname.split("/").pop()!;
    await context.close();
    return projectId;
  } finally {
    await browser.close();
  }
}

/**
 * Привязка проекта к ProjectCEO.
 *
 * ⚠️ Известное отступление, зафиксированное в AP5_RUNBOOK.md: у самой
 * `enroll_organization_project` нет HTTP-поверхности — ни маршрута, ни элемента
 * интерфейса, `FoundationService` никуда не подключён. Поэтому вызов идёт RPC
 * от лица owner ЕГО ЖЕ access token: инвариант «human operations не выполняются
 * через service role» соблюдён, но браузерным доказательством этот шаг не
 * является. Создание самого проекта — уже браузерное, см. выше.
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

/** Сессия рождается в браузере: он сам проходит по ссылке и получает куку. */
async function captureBrowserSession(role: Ap5RoleKey): Promise<string> {
  const { tokenHash, userId } = await issueMagicLink(role);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: env.appUrl });
    const page = await context.newPage();
    await page.goto(callbackUrl(tokenHash));
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 30_000 });

    // Отказ самой ссылки виден по ?error=… — обработчик уводит на /login именно
    // так. Без этой проверки сохранили бы пустую сессию и получили невнятный
    // отказ через три шага.
    const landing = new URL(page.url());
    if (landing.searchParams.has("error") || landing.searchParams.has("error_description")) {
      throw new Error(`AP5: ссылка ${role} отвергнута: ${page.url()}`);
    }

    // Хост в редиректе обработчика может отличаться от того, на котором стоят
    // куки: ходим на 127.0.0.1, а `${origin}` собирается как localhost. Для кук
    // это разные хосты, и proxy.ts на втором сессии уже не видит. Поэтому на
    // рабочий экран возвращаемся сами, по базовому адресу.
    await page.goto("/dashboard");
    if (new URL(page.url()).pathname.startsWith("/login")) {
      throw new Error(`AP5: сессия ${role} не установилась: ${page.url()}`);
    }
    await context.storageState({ path: storageStatePath(role) });
    await context.close();
    return userId;
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
    // Конверт команды — {status, operation, replay, stateRevision, result},
    // без `data`: `data` есть у читающих маршрутов, у командного нет.
    const invitationUrl = body?.result?.invitationUrl;
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

    // Ответ сервера перехватывается до проверки вёрстки. Иначе отказ приёма
    // выглядит как таймаут ожидания ссылки и не говорит ничего: страница при
    // ошибке просто остаётся с кнопкой.
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) => candidate.url().includes("/api/projectceo/invitations/accept"),
        { timeout: 30_000 },
      ),
      page.locator("main button.btn-primary").first().click(),
    ]);
    const body = await response.json();
    if (body?.status !== "completed") {
      throw new Error(
        `AP5: приём приглашения ${role} отказал: `
        + `${response.status()} ${JSON.stringify(body)}`,
      );
    }

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

  const userIds: Record<string, string> = {};

  for (const role of AP5_ROLES) {
    userIds[role.key] = await captureBrowserSession(role.key);
  }

  // Сессия owner уже есть — проект создаётся ею, и только потом привязывается.
  const projectId = await createLegacyProject();
  await enroll(await accessTokenFor("owner"), projectId);

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
