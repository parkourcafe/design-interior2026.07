import { describe, expect, it } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { matchHas, prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";
import nextConfig, { legacyHostRedirects } from "@/next.config.mjs";

type Redirect = ReturnType<typeof legacyHostRedirects>[number];

// Прогоняем правило теми же функциями Next, которыми он матчит redirects в
// рантайме: source → params, has(host) → совпадение, destination → Location.
function resolveRedirect(rule: Redirect, host: string, pathname: string, search = "") {
  const params = getPathMatch(rule.source, { removeUnnamedParams: true, strict: true })(pathname);
  if (!params) return null;
  const query = Object.fromEntries(new URLSearchParams(search));
  const req = { headers: { host }, cookies: {} } as never;
  const hasParams = matchHas(req, query, rule.has as never);
  if (!hasParams) return null;
  const { parsedDestination: dest } = prepareDestination({
    appendParamsToQuery: false,
    destination: rule.destination,
    params: { ...params, ...hasParams },
    query,
  });
  // Как resolve-routes: query назначения → search, затем formatUrl.
  const url = new URL(`${dest.protocol}//${dest.hostname}${dest.port ? `:${dest.port}` : ""}${dest.pathname}`);
  for (const [key, value] of Object.entries(dest.query)) url.searchParams.set(key, String(value));
  return url.toString();
}

describe("301 со старого домена arhidom.space (ADR-0005)", () => {
  const [rule] = legacyHostRedirects("https://www.remhaos.com");

  it("одно правило, код 301", () => {
    expect(rule).toBeDefined();
    expect(rule!.statusCode).toBe(301);
  });

  it.each([
    ["arhidom.space", "/", "https://www.remhaos.com/"],
    ["www.arhidom.space", "/", "https://www.remhaos.com/"],
    ["arhidom.space", "/studios", "https://www.remhaos.com/studios"],
    ["arhidom.space", "/for-clients/project-cost", "https://www.remhaos.com/for-clients/project-cost"],
    ["www.arhidom.space", "/i/some-token", "https://www.remhaos.com/i/some-token"],
    ["arhidom.space", "/sitemap.xml", "https://www.remhaos.com/sitemap.xml"],
    ["arhidom.space", "/apiary", "https://www.remhaos.com/apiary"],
  ])("%s%s → %s", (host, path, location) => {
    expect(resolveRedirect(rule!, host, path)).toBe(location);
  });

  it("сохраняет query (UTM)", () => {
    expect(resolveRedirect(rule!, "arhidom.space", "/pilot", "utm_source=x")).toBe(
      "https://www.remhaos.com/pilot?utm_source=x",
    );
  });

  it.each(["/api/assetlinks", "/api", "/auth/callback", "/auth", "/.well-known/apple-app-site-association"])(
    "не трогает %s (POST-клиенты, PKCE-cookie, AASA)",
    (path) => {
      expect(resolveRedirect(rule!, "arhidom.space", path)).toBeNull();
    },
  );

  it.each(["www.remhaos.com", "remhaos.com", "localhost:3000", "preview-xyz.vercel.app", "arhidom.space.evil.test"])(
    "не срабатывает на хосте %s",
    (host) => {
      expect(resolveRedirect(rule!, host, "/studios")).toBeNull();
    },
  );

  it("не создаёт цикл, если canonical origin сам на arhidom.space", () => {
    expect(legacyHostRedirects("https://www.arhidom.space")).toEqual([]);
  });

  it("подключено в next.config", async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects).toHaveLength(1);
    expect(redirects?.[0]?.destination).toBe("https://www.remhaos.com/:path");
  });
});
