import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

describe("RemHaOS brand rename contract", () => {
  const legacyFirstSpelling = ["Rem", "ha", "OS"].join("");
  const legacySecondSpelling = ["Rem", "Haos"].join("");
  const legacyProductBrand = ["Archi", "Dom"].join("");
  const legacyUpperBrand = "ARHIDOM";
  const legacyPublicBrandPattern = new RegExp(
    `\\b(?:${legacyFirstSpelling}|${legacySecondSpelling}|${legacyProductBrand}|${legacyUpperBrand})\\b`,
  );

  const activePublicFiles = [
    "app/layout.tsx",
    "app/manifest.ts",
    "app/page.tsx",
    "app/robots.ts",
    "app/sitemap.ts",
    "app/llms.txt/route.ts",
    "components/landing/loop-scene.tsx",
    "lib/i18n/ru.ts",
    "lib/env.ts",
    "public/sw.js",
    ".env.example",
  ];

  it("removes legacy public brand strings from active runtime surfaces", () => {
    for (const file of activePublicFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(legacyPublicBrandPattern);
      expect(source, file).not.toMatch(/arhidom\.space/i);
    }
  });

  it("uses RemHaOS and remhaos.com in app metadata and generated discovery files", () => {
    const layout = read("app/layout.tsx");
    expect(read("lib/i18n/ru.ts")).toContain('name: "RemHaOS"');
    expect(layout).toContain("https://remhaos.com");
    expect(layout).toContain('process.env.VERCEL_ENV === "preview"');
    expect(layout).toContain('process.env.VERCEL_ENV !== "preview"');
    expect(read("app/robots.ts")).toContain("https://remhaos.com/sitemap.xml");
    expect(read("app/sitemap.ts")).toContain("https://remhaos.com");
    expect(read("app/llms.txt/route.ts")).toContain("Canonical host: https://remhaos.com");
  });

  it("keeps legacy host handling only as explicit one-hop redirects", () => {
    const nextConfig = read("next.config.mjs");
    expect(nextConfig).toContain('value: "arhidom.space"');
    expect(nextConfig).toContain('value: "www.arhidom.space"');
    expect(nextConfig).toContain('destination: "https://remhaos.com/:path*"');
    expect(nextConfig).not.toMatch(/destination:\s*["']https:\/\/remhaos\.com\/["']/);
  });
});
