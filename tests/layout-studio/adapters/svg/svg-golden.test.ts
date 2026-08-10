import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createSvgProjection,
  serializeSvgProjection,
} from "@/lib/layout-studio/adapters/svg/svg-projection";
import { deriveLayout, type LayoutDocument } from "@/lib/layout-studio/domain";
import koraFixture from "@/fixtures/layout-studio/kora-liquid-station.v0.2.json";
import simpleFixture from "@/fixtures/layout-studio/simple-room.v0.2.json";

const GOLDEN_DIR = path.join(process.cwd(), "tests/layout-studio/adapters/svg/golden");

function render(document: LayoutDocument): string {
  return serializeSvgProjection(
    createSvgProjection(deriveLayout(document), { versionId: "V1" }),
  );
}

function golden(name: string): string {
  return readFileSync(path.join(GOLDEN_DIR, `${name}.v0.1.svg`), "utf8").trimEnd();
}

describe("LS-AT-026: SVG golden", () => {
  it.each([
    ["kora-liquid-station", koraFixture],
    ["simple-room", simpleFixture],
  ])("renders %s byte-for-byte against the committed golden", (name, fixture) => {
    expect(render(fixture as unknown as LayoutDocument)).toBe(golden(name));
  });

  it("is deterministic across repeated renders of the same document", () => {
    const document = koraFixture as unknown as LayoutDocument;
    expect(render(document)).toBe(render(document));
  });

  it("keeps the golden free of presentation state and private references", () => {
    for (const name of ["kora-liquid-station", "simple-room"]) {
      const svg = golden(name);
      expect(svg).not.toMatch(/selected|selection|hover|localStorage|auth[_-]?token/i);
      expect(svg).not.toMatch(/\/(?:home|Users|private|var\/folders)\//);
      expect(svg).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    }
  });
});

describe("LS-AT-071: exported SVG shows openings", () => {
  it("draws each opening as a stroked span on its parent wall axis", () => {
    const svg = render(koraFixture as unknown as LayoutDocument);

    for (const opening of (koraFixture as unknown as LayoutDocument).openings) {
      const group = new RegExp(
        `<g data-source-id="${opening.id}"[^>]*>(.*?)</g>`,
        "s",
      ).exec(svg);
      expect(group, `opening ${opening.id} must be serialized`).not.toBeNull();
      const body = group?.[1] ?? "";
      const lines = [...body.matchAll(/<line [^/]*\/>/g)];
      expect(lines.length, `opening ${opening.id} must be drawable`).toBeGreaterThanOrEqual(2);
      expect(body).toMatch(/stroke="#[0-9A-F]{6}"/);
      expect(body).toMatch(/stroke-width="\d+"/);
    }
  });

  it("places the opening span at the resolved wall coordinates", () => {
    const projection = createSvgProjection(
      deriveLayout(koraFixture as unknown as LayoutDocument),
    );
    const door = projection.openings.find((item) => item.sourceId === "opening.kora.rear-door");

    // Rear wall runs (0,3000) → (8100,3000); the 1200 mm door starts at 3235 mm.
    expect(door?.startPoint).toEqual({ xMm: 3235, yMm: 3000 });
    expect(door?.endPoint).toEqual({ xMm: 4435, yMm: 3000 });
    // Door centre shares the column axis at X = 3835 mm (owner-confirmed intent).
    expect(((door?.startPoint.xMm ?? 0) + (door?.endPoint.xMm ?? 0)) / 2).toBe(3835);
  });

  it("draws openings after walls so the wall reads as interrupted", () => {
    const svg = render(koraFixture as unknown as LayoutDocument);
    expect(svg.indexOf("<g data-source-id=\"opening.")).toBeGreaterThan(
      svg.lastIndexOf("<polygon data-source-id=\"wall."),
    );
  });
});
