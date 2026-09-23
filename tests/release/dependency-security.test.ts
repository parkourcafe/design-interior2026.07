import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
  packages: Record<string, { version?: string }>;
};

function atLeast(version: string, minimum: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const actual = version.split(".").map(Number);
  const floor = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const current = actual[index];
    const required = floor[index];
    if (current === undefined || required === undefined) return false;
    if (current !== required) return current > required;
  }
  return true;
}

// Regression floors for the advisories observed on 2026-09-23, not a substitute
// for a fresh npm audit or proof that every future version is vulnerability-free.
const floors: Readonly<Record<string, string>> = {
  next: "16.3.3",
  sharp: "0.35.4",
  vitest: "4.1.11",
  "@vitest/mocker": "4.1.11",
  "@xmldom/xmldom": "0.9.12",
  "baseline-browser-mapping": "2.11.0",
  browserslist: "4.28.7",
  "fast-uri": "3.1.6",
  "js-yaml": "4.3.2",
  nanoid: "3.3.18",
  tar: "7.5.21",
};

describe("dependency security regression floors", () => {
  it("retains compatible framework/test families and the explicit native override", () => {
    expect(manifest.dependencies.next).toMatch(/^\^16\./);
    expect(atLeast(manifest.dependencies.next.slice(1), "16.3.3")).toBe(true);
    expect(manifest.devDependencies["eslint-config-next"]).toBe(manifest.dependencies.next);
    expect(manifest.devDependencies.vitest).toMatch(/^\^4\./);
    expect(atLeast(manifest.devDependencies.vitest.slice(1), "4.1.11")).toBe(true);
    expect(manifest.overrides.sharp).toMatch(/^0\.35\./);
    expect(atLeast(manifest.overrides.sharp, "0.35.4")).toBe(true);
    expect(lock.packages["node_modules/next"]?.version)
      .toBe(lock.packages["node_modules/eslint-config-next"]?.version);
    expect(lock.packages["node_modules/vitest"]?.version)
      .toBe(lock.packages["node_modules/@vitest/mocker"]?.version);
  });

  it("checks all matching lockfile copies, including nested transitive packages", () => {
    for (const [name, minimum] of Object.entries(floors)) {
      const copies = Object.entries(lock.packages)
        .filter(([path]) => path.endsWith(`node_modules/${name}`));
      expect(copies.length, name).toBeGreaterThan(0);
      for (const [path, entry] of copies) {
        expect(atLeast(entry.version ?? "", minimum), `${path}@${entry.version}`)
          .toBe(true);
      }
    }
    const braces = Object.entries(lock.packages)
      .filter(([path]) => path.endsWith("node_modules/brace-expansion"));
    expect(braces.length).toBeGreaterThan(0);
    for (const [path, entry] of braces) {
      const version = entry.version ?? "";
      const floor = version.startsWith("1.") ? "1.1.18" : "5.0.9";
      expect(atLeast(version, floor), `${path}@${version}`).toBe(true);
    }
  });

  it("round-trips a synthetic AVIF through the installed native image library", async () => {
    const avif = await sharp({
      create: { width: 3, height: 2, channels: 3, background: { r: 32, g: 64, b: 96 } },
    }).avif().toBuffer();
    const metadata = await sharp(avif).metadata();
    expect(metadata.width).toBe(3);
    expect(metadata.height).toBe(2);
    const resized = await sharp(avif).resize(6, 4).webp().toBuffer();
    const output = await sharp(resized).metadata();
    expect(output).toMatchObject({ format: "webp", width: 6, height: 4 });
  });
});
