import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DesignerCard from "@/components/designer-card";
import { googleSignInEnabled } from "@/lib/supabase/auth-providers";
import { ru } from "@/lib/i18n/ru";

// ТЗ 08.10.2026, FIX-04: заголовок карточки дизайнера (P2) и кнопка Google
// по настройке провайдера. Тексты D6/D7/D8 проверяются в браузере на стенде.

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://ru.auth.test/",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test",
} as unknown as NodeJS.ProcessEnv;

function settings(body: unknown, status = 200): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    expect(String(url)).toBe("https://ru.auth.test/auth/v1/settings");
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe("designer card title (P2)", () => {
  const profile = { phone: "+7 900 000-00-00" };

  it("uses name or studio, never the email, as the title", () => {
    const html = renderToStaticMarkup(
      <DesignerCard designer={{ name: "", studio_name: "Студия Север", email: "owner@studio.test", profile }} />,
    );
    expect(html).toMatch(/data-testid="designer-card-title">Студия Север</);
  });

  it("shows a neutral title with the email kept as a separate contact", () => {
    const html = renderToStaticMarkup(
      <DesignerCard designer={{ name: " ", studio_name: "", email: "owner@studio.test", profile }} />,
    );
    expect(html).toContain(`data-testid="designer-card-title">${ru.designerCard.untitled}<`);
    expect(html).toContain('href="mailto:owner@studio.test"');
    expect(html).not.toContain(ru.designerCard.untitledPreview);
    const preview = renderToStaticMarkup(
      <DesignerCard preview designer={{ name: "", studio_name: "", email: "owner@studio.test", profile }} />,
    );
    expect(preview).toContain(ru.designerCard.untitledPreview);
  });
});

describe("Google sign-in follows the provider configuration", () => {
  it("shows Google only when the contour's Auth reports it enabled", async () => {
    expect(await googleSignInEnabled("ru", settings({ external: { google: true, email: true } }), ENV)).toBe(true);
    expect(await googleSignInEnabled("ru", settings({ external: { google: false, email: true } }), ENV)).toBe(false);
    expect(await googleSignInEnabled("ru", settings({}), ENV)).toBe(false);
  });

  it("hides Google when settings are unavailable or the contour is not configured", async () => {
    expect(await googleSignInEnabled("ru", settings({ external: { google: true } }, 503), ENV)).toBe(false);
    expect(await googleSignInEnabled("ru", (async () => { throw new Error("offline"); }) as typeof fetch, ENV)).toBe(false);
    expect(await googleSignInEnabled("us", settings({ external: { google: true } }), ENV)).toBe(false);
  });
});
