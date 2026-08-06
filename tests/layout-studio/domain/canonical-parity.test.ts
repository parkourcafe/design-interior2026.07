import { describe, expect, it } from "vitest";

import {
  canonicalSerialize,
  type LayoutDocument,
} from "@/lib/layout-studio/domain";

const CODE_POINT_ORDERED_IDS = [
  "-dash",
  ".dot",
  "A.upper",
  "_under",
  "a.lower",
  "\uE000.bmp",
  "\u{10000}.astral",
] as const;

function makeParityVector(ids: readonly string[]): LayoutDocument {
  return {
    contractVersion: "archidom.layout-document/0.1",
    documentId: "document.canonical-parity",
    projectId: "project.canonical-parity",
    name: "Canonical parity vector",
    canonicalUnits: "mm",
    stateRevision: 42,
    floor: {
      id: "floor.canonical-parity",
      label: "Floor",
      elevationMm: -9_007_199_254_740_991,
      clearHeightMm: 9_007_199_254_740_991,
      session: { selected: true },
    },
    variant: {
      id: "variant.canonical-parity",
      label: "Variant",
      status: "draft",
    },
    nodes: ids.map((id) => {
      const canonicalIndex = CODE_POINT_ORDERED_IDS.indexOf(
        id as (typeof CODE_POINT_ORDERED_IDS)[number],
      );
      return {
        id,
        xMm: id === CODE_POINT_ORDERED_IDS[0] ? -9_007_199_254_740_991 : 0,
        yMm: id === CODE_POINT_ORDERED_IDS.at(-1) ? 9_007_199_254_740_991 : 1,
        locked: false,
        nested: {
          retained: { threshold: canonicalIndex },
          stateRevision: 900 + canonicalIndex,
          updatedAt: `2099-01-0${canonicalIndex + 1}T00:00:00.000Z`,
          selection: { entityId: id },
          session: { zoom: canonicalIndex + 1 },
        },
      };
    }),
    walls: [],
    openings: [],
    columns: [],
    objects: [],
    clearanceZones: [],
    materials: [],
    materialAssignments: [],
    lights: [],
    metadata: {
      sourceRefs: ["contract:sql-c-collation-parity"],
      warnings: [],
      retained: {
        minimumSafeInteger: -9_007_199_254_740_991,
        zero: 0,
        maximumSafeInteger: 9_007_199_254_740_991,
      },
      stateRevision: 7,
      session: { locale: "ru-RU" },
    },
    updatedAt: "2099-12-31T23:59:59.999Z",
    selection: { entityId: ids[0] },
    session: { locale: "en-US" },
  };
}

describe("LS-011: Layout Studio and PostgreSQL canonical hash parity", () => {
  it("sorts stable entity IDs by Unicode code point and preserves the canonical numeric vector", () => {
    const reverseInput = makeParityVector([...CODE_POINT_ORDERED_IDS].reverse());
    const shuffledInput = makeParityVector([
      "a.lower",
      "\u{10000}.astral",
      "-dash",
      "\uE000.bmp",
      "_under",
      "A.upper",
      ".dot",
    ]);

    const reverseSerialized = canonicalSerialize(reverseInput);
    const shuffledSerialized = canonicalSerialize(shuffledInput);
    const reverseCanonical = JSON.parse(reverseSerialized) as Record<string, unknown>;
    const shuffledCanonical = JSON.parse(shuffledSerialized) as Record<string, unknown>;
    const reverseNodes = reverseCanonical.nodes as Array<Record<string, unknown>>;
    const shuffledNodes = shuffledCanonical.nodes as Array<Record<string, unknown>>;

    expect(reverseNodes.map(({ id }) => id)).toEqual(CODE_POINT_ORDERED_IDS);
    expect(shuffledNodes.map(({ id }) => id)).toEqual(CODE_POINT_ORDERED_IDS);
    expect(shuffledSerialized).toBe(reverseSerialized);
    expect(reverseCanonical).not.toHaveProperty("stateRevision");
    expect(reverseCanonical).not.toHaveProperty("updatedAt");
    expect(reverseCanonical).not.toHaveProperty("selection");
    expect(reverseCanonical).not.toHaveProperty("session");
    expect(reverseCanonical).not.toHaveProperty("floor.session");
    expect(reverseCanonical).not.toHaveProperty("metadata.stateRevision");
    expect(reverseCanonical).not.toHaveProperty("metadata.session");
    expect(reverseNodes[0]).not.toHaveProperty("nested.stateRevision");
    expect(reverseNodes[0]).not.toHaveProperty("nested.updatedAt");
    expect(reverseNodes[0]).not.toHaveProperty("nested.selection");
    expect(reverseNodes[0]).not.toHaveProperty("nested.session");
    expect(reverseCanonical).toHaveProperty("metadata.retained", {
      maximumSafeInteger: 9_007_199_254_740_991,
      minimumSafeInteger: -9_007_199_254_740_991,
      zero: 0,
    });
    expect(reverseNodes[0]).toHaveProperty("xMm", -9_007_199_254_740_991);
    expect(reverseNodes.at(-1)).toHaveProperty("yMm", 9_007_199_254_740_991);
  });
});
