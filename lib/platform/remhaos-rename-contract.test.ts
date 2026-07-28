import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

describe("RemHaos brand rename contract", () => {
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
      expect(source, file).not.toMatch(/\b(?:ArchiDom|ARHIDOM)\b/);
      expect(source, file).not.toMatch(/arhidom\.space/i);
    }
  });

  it("uses RemHaos and remhaos.com in app metadata and generated discovery files", () => {
    expect(read("lib/i18n/ru.ts")).toContain('name: "RemHaos"');
    expect(read("app/layout.tsx")).toContain("https://remhaos.com");
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
