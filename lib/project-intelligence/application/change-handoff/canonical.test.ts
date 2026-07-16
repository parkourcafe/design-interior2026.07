import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson, semanticSha256 } from "./index";

describe("change-handoff canonical JSON", () => {
  it("sorts recursive object keys by Unicode code point while preserving array order", () => {
    const value = {
      "\u{10000}": { z: 1, a: 2 },
      "\uE000": ["second", "first"],
    };

    expect(canonicalJson(value)).toBe(
      "{\"\uE000\":[\"second\",\"first\"],\"\u{10000}\":{\"a\":2,\"z\":1}}",
    );
  });

  it("computes the accepted fixture hash from logical content rather than artifact metadata", () => {
    const handoff = JSON.parse(readFileSync(join(
      process.cwd(),
      "fixtures/project-intelligence/kitchen-worktop/expected-handoff.json",
    ), "utf8")) as {
      artifact: { semanticContentHash: string };
      logicalContent: unknown;
    };

    expect(semanticSha256(handoff.logicalContent)).toBe(handoff.artifact.semanticContentHash);
    expect(semanticSha256(handoff.logicalContent)).toBe(
      "sha256:9c7d1eddd1278bda3308fc8c41b20908ee3f600e08848b49a910484fb3e8484b",
    );
  });

  it("rejects values that are not JSON contract values", () => {
    expect(() => canonicalJson({ invalid: undefined })).toThrowError(TypeError);
    expect(() => canonicalJson(Number.NaN)).toThrowError(TypeError);
  });

  it("rejects sparse arrays and enumerable array properties instead of collapsing shapes", () => {
    expect(() => canonicalJson(Array(1))).toThrowError(TypeError);
    expect(() => canonicalJson(["first", , "third"])).toThrowError(TypeError);

    const arrayWithMetadata = ["value"] as string[] & { metadata?: string };
    arrayWithMetadata.metadata = "not-a-json-array-element";
    expect(() => canonicalJson(arrayWithMetadata)).toThrowError(TypeError);

    const arrayWithAccessor = ["value"];
    Object.defineProperty(arrayWithAccessor, "0", {
      enumerable: true,
      get: () => "computed",
    });
    expect(() => canonicalJson(arrayWithAccessor)).toThrowError(TypeError);

    const arrayWithSymbol = ["value"] as string[] & { [key: symbol]: string };
    arrayWithSymbol[Symbol("metadata")] = "not-a-json-array-element";
    expect(() => canonicalJson(arrayWithSymbol)).toThrowError(TypeError);
  });
});
