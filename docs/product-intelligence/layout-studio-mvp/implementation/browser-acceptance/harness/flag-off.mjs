// LS-AT-080/081: with ARCHIDOM_LAYOUT_STUDIO_ENABLED unset, an *authenticated*
// user must still get 404 on both Layout Studio routes.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:3100";
const OUT = process.env.E2E_OUT ?? path.resolve("evidence");
fs.mkdirSync(OUT, { recursive: true });
const EMAIL = `layout-studio.qa+flagoff${process.env.RUN ?? "1"}@archidom.invalid`;

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Нет аккаунта? Зарегистрироваться", exact: true }).click();
await page.locator("#email").fill(EMAIL);
await page.locator("#password").fill("LayoutStudioQA!2026");
await page.locator('form button[type="submit"]').first().click();
await page.waitForTimeout(5000);

const authenticated = (await context.cookies()).some((c) => /^sb-.*-auth-token/.test(c.name));
const results = [];
for (const route of ["/app/layout-studio", "/app/layout-studio/kora-liquid-station"]) {
  const response = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  const body = await page.locator("body").innerText();
  results.push({
    route,
    status: response?.status() ?? null,
    finalPath: new URL(page.url()).pathname,
    rendersEditor: body.includes("Редактор планировки"),
  });
}

const ok = authenticated && results.every((r) => r.status === 404 && !r.rendersEditor);
const payload = { authenticated, results, pass: ok, checkedAt: new Date().toISOString() };
fs.writeFileSync(path.join(OUT, "flag-off-result.json"), JSON.stringify(payload, null, 2));
console.log(JSON.stringify(payload, null, 2));

await browser.close();
process.exit(ok ? 0 : 1);
