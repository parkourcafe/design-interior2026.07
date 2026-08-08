// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyLayoutCommand,
  type LayoutCommand,
} from "@/lib/layout-studio/domain";

import { makeSimpleRoom } from "../application/layout-test-fixture";

const repoRoot = process.cwd();

function componentSource(): string {
  const root = join(repoRoot, "components/layout-studio");
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name))
    .map((entry) => readFileSync(join(root, entry.name), "utf8"))
    .join("\n");
}

function expectSource(source: string, pattern: RegExp, capability: string): void {
  expect(pattern.test(source), capability).toBe(true);
}

describe("Days 3/4: 2D editor capabilities", () => {
  it("exposes pan/fit controls, visible dimensions and object labels", () => {
    const source = componentSource();

    expectSource(source, /pan(?:X|Y|Offset|State)|setPan/i, "2D canvas must keep explicit pan state");
    expectSource(source, /fit(?:To)?View|fitViewport/i, "2D canvas must expose fit-to-view");
    expectSource(source, /dimension/i, "2D canvas must render dimension data");
    expectSource(source, /<text\b/i, "dimensions and labels must be visible SVG text");
    expectSource(source, /(?:object|entity)\.label/i, "object labels must use canonical entity labels");
  });

  it("renders clearance zones behind an accessible layer toggle", () => {
    const source = componentSource();

    expectSource(source, /clearanceZones/, "canonical clearance zones must be rendered");
    expectSource(source, /showClearance|toggleClearance|clearanceLayer/i, "clearance visibility needs its own layer state");
    expectSource(source, /aria-pressed|role=["'{]switch|type=["'{]checkbox/i, "clearance toggle must expose accessible state");
  });

  it("updates equipment rotation and all three dimensions through UPDATE_OBJECT", () => {
    const original = makeSimpleRoom();
    const result = applyLayoutCommand(original, {
      commandId: "command.simple-room.update-table",
      idempotencyKey: "idem.simple-room.update-table",
      documentId: original.documentId,
      expectedStateRevision: original.stateRevision,
      type: "UPDATE_OBJECT",
      payload: {
        objectId: "object.simple-room.table",
        rotationDeg: 90,
        widthMm: 800,
        depthMm: 700,
        heightMm: 950,
      },
      reasonCode: "USER_INSPECTOR_EDIT",
      reason: "Числовое редактирование оборудования",
    } as unknown as LayoutCommand);

    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.document.stateRevision).toBe(original.stateRevision + 1);
    expect(result.document.objects[0]).toMatchObject({
      rotationDeg: 90,
      widthMm: 800,
      depthMm: 700,
      heightMm: 950,
    });
    expect(original.objects[0]).toMatchObject({
      rotationDeg: 0,
      widthMm: 600,
      depthMm: 600,
      heightMm: 900,
    });
    expectSource(
      componentSource(),
      /UPDATE_OBJECT[\s\S]{0,1200}(?:rotationDeg|widthMm|depthMm|heightMm)/,
      "inspector must dispatch UPDATE_OBJECT for rotation and dimensions",
    );
  });

  it("rejects an update to a locked opening without changing the document", () => {
    const original = makeSimpleRoom();
    const result = applyLayoutCommand(original, {
      commandId: "command.simple-room.update-door",
      idempotencyKey: "idem.simple-room.update-door",
      documentId: original.documentId,
      expectedStateRevision: original.stateRevision,
      type: "UPDATE_OPENING",
      payload: {
        openingId: "opening.simple-room.door",
        offsetMm: 1200,
        widthMm: 1000,
      },
      reasonCode: "USER_INSPECTOR_EDIT",
      reason: "Попытка изменить заблокированный проём",
    } as unknown as LayoutCommand);

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "ENTITY_LOCKED" }));
    expect(result.document).toEqual(original);
  });
});

describe("Day 9: route and shell hardening", () => {
  it("provides loading, error and empty states with keyboard-accessible controls", () => {
    const route = readFileSync(join(repoRoot, "app/app/layout-studio/page.tsx"), "utf8");
    const source = `${route}\n${componentSource()}`;

    expectSource(source, /loading|загруз/i, "route/shell must expose a loading state");
    expectSource(source, /error|ошиб/i, "route/shell must expose an error state");
    expectSource(source, /empty|пуст|нет данных/i, "route/shell must expose an empty state");
    expectSource(source, /<button\b/i, "shell controls must use native buttons");
    expectSource(source, /aria-label|aria-labelledby/i, "shell controls must have accessible names");
    expectSource(source, /onKeyDown|aria-keyshortcuts|tabIndex/i, "canvas/editor controls must support keyboard interaction");
  });
});
