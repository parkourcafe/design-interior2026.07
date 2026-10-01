import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import sitemap, { INTENT_ROUTES, ROUTES } from "@/app/sitemap";
import robots from "@/app/robots";
import { PUBLISHED_INTENTS } from "@/lib/seo/intents";

const repoRoot = resolve(__dirname, "../..");

function pageSource(path: string): string {
  const dir = path === "/" ? "app" : `app${path}`;
  const file = resolve(repoRoot, dir, "page.tsx");
  expect(existsSync(file), `нет app-маршрута для ${path}`).toBe(true);
  return readFileSync(file, "utf8");
}

// noindex в этом репозитории задаётся одним из двух способов: литералом
// robots.index=false в metadata страницы или флагом noindex хелпера
// intentPageMetadata. Оба ищутся в исходнике страницы.
function isNoindex(source: string): boolean {
  return /index:\s*false/.test(source) || /noindex:\s*true/.test(source);
}

describe("sitemap.xml", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("содержит только индексируемые страницы", () => {
    for (const route of [...ROUTES, ...INTENT_ROUTES]) {
      expect(isNoindex(pageSource(route.path)), `${route.path} закрыт noindex, но стоит в sitemap`).toBe(false);
    }
  });

  it("не содержит страниц, закрытых noindex решением владельца", () => {
    const paths = [...ROUTES, ...INTENT_ROUTES].map((r) => r.path);
    for (const closed of ["/support", "/legal/privacy", "/legal/terms", "/legal/consent"]) {
      expect(isNoindex(pageSource(closed)), `${closed} больше не noindex — пересмотрите тест`).toBe(true);
      expect(paths).not.toContain(closed);
    }
  });

  it("включает все опубликованные интент-страницы", () => {
    expect(INTENT_ROUTES.map((r) => r.path).sort()).toEqual(PUBLISHED_INTENTS.map((i) => i.route).sort());
    expect(INTENT_ROUTES).toHaveLength(22);
  });

  it("строит абсолютные URL на каноническом хосте www.remhaos.com", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.remhaos.com");
    const entries = sitemap();
    expect(entries.length).toBe(ROUTES.length + INTENT_ROUTES.length);
    for (const entry of entries) {
      expect(entry.url.startsWith("https://www.remhaos.com")).toBe(true);
      expect(entry.url).not.toMatch(/\/$/);
    }
    expect(entries.map((e) => e.url)).toContain("https://www.remhaos.com");
  });

  it("в production без env падает на www.remhaos.com, а не на голый домен", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    vi.stubEnv("NODE_ENV", "production");
    expect(sitemap()[0]?.url).toBe("https://www.remhaos.com");
    expect(robots().sitemap).toBe("https://www.remhaos.com/sitemap.xml");
  });
});

describe("robots.txt", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("указывает на sitemap канонического хоста", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.remhaos.com");
    expect(robots().sitemap).toBe("https://www.remhaos.com/sitemap.xml");
  });

  it("не закрывает ни одну страницу из sitemap", () => {
    const rules = robots().rules;
    const disallow = (Array.isArray(rules) ? rules : [rules]).flatMap((r) =>
      r.disallow === undefined ? [] : Array.isArray(r.disallow) ? r.disallow : [r.disallow],
    );
    for (const route of [...ROUTES, ...INTENT_ROUTES]) {
      for (const prefix of disallow) {
        const blocked = prefix.endsWith("/") ? route.path.startsWith(prefix) : route.path === prefix || route.path.startsWith(`${prefix}/`);
        expect(blocked, `${route.path} закрыт robots-правилом ${prefix}`).toBe(false);
      }
    }
  });
});

describe("canonical и og:url на индексируемых страницах", () => {
  it("каждая страница из sitemap объявляет свой canonical", async () => {
    for (const route of [...ROUTES, ...INTENT_ROUTES]) {
      const dir = route.path === "/" ? "app" : `app${route.path}`;
      const mod = (await import(resolve(repoRoot, dir, "page.tsx"))) as {
        metadata?: { alternates?: { canonical?: string }; openGraph?: { url?: string; images?: unknown[] } };
      };
      expect(mod.metadata?.alternates?.canonical, `${route.path}: canonical`).toBe(route.path);
      expect(mod.metadata?.openGraph?.url, `${route.path}: og:url`).toBe(route.path);
      expect(mod.metadata?.openGraph?.images?.length, `${route.path}: og:image`).toBeGreaterThan(0);
    }
  }, 120_000);
});
