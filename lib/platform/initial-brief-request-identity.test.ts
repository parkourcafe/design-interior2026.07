import { describe, expect, it } from "vitest";
import {
  canonicalJsonStringify,
  deriveInitialBriefRequestIdentity,
} from "./initial-brief-request-identity";

describe("initial brief request identity", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(
      canonicalJsonStringify({
        z: [{ b: 2, a: 1 }],
        a: { d: "four", c: "three" },
      }),
    ).toBe('{"a":{"c":"three","d":"four"},"z":[{"a":1,"b":2}]}');
  });

  it("is stable for equivalent answers and bound to the project", () => {
    const first = deriveInitialBriefRequestIdentity("project-a", {
      household: { pets: true, kids: false },
      style: ["warm", "minimal"],
    });
    const reordered = deriveInitialBriefRequestIdentity("project-a", {
      style: ["warm", "minimal"],
      household: { kids: false, pets: true },
    });
    const anotherProject = deriveInitialBriefRequestIdentity("project-b", {
      household: { pets: true, kids: false },
      style: ["warm", "minimal"],
    });

    expect(reordered).toEqual(first);
    expect(first.answerDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(anotherProject.answerDigest).toBe(first.answerDigest);
    expect(anotherProject.idempotencyKey).not.toBe(first.idempotencyKey);
  });
});
