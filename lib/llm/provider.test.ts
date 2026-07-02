import { describe, it, expect } from "vitest";
import { extractJson } from "./provider";

describe("extractJson", () => {
  it("returns clean JSON unchanged", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("strips ```json fences", () => {
    const raw = "```json\n{\"a\":1}\n```";
    expect(JSON.parse(extractJson(raw))).toEqual({ a: 1 });
  });

  it("strips bare ``` fences", () => {
    const raw = "```\n[1,2,3]\n```";
    expect(JSON.parse(extractJson(raw))).toEqual([1, 2, 3]);
  });

  it("extracts JSON surrounded by prose", () => {
    const raw = 'Вот результат: [{"x":1}] — надеюсь, подходит.';
    expect(JSON.parse(extractJson(raw))).toEqual([{ x: 1 }]);
  });

  it("handles nested objects when picking outermost braces", () => {
    const raw = 'prefix {"a":{"b":2}} suffix';
    expect(JSON.parse(extractJson(raw))).toEqual({ a: { b: 2 } });
  });
});
