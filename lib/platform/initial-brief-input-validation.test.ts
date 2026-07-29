import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QUESTIONS } from "@/lib/brief/questions";
import {
  declaredInitialBriefRequestTooLarge,
  InitialBriefRequestTooLargeError,
  INITIAL_BRIEF_INPUT_LIMITS,
  parseInitialBriefInput,
  readBoundedInitialBriefBody,
} from "./initial-brief-input-validation";

const routeSource = readFileSync(
  new URL("../../app/api/intake/submit/route.ts", import.meta.url),
  "utf8",
);

function body(
  answers: Record<string, unknown>,
  token = "brief-token-123",
): string {
  return JSON.stringify({ token, answers });
}

function nestedAnswer(depth: number): unknown {
  let value: unknown = "leaf";
  for (let level = 0; level < depth; level += 1) {
    value = { next: value };
  }
  return value;
}

describe("initial brief public input validation", () => {
  it("accepts a representative valid M1 brief and preserves its JSON values", () => {
    const input = {
      token: "brief-token-123",
      answers: {
        object: { type: "flat", area_m2: 78, city: "Москва" },
        vision: "Светлая квартира для семьи с рабочим местом.",
        asset_horizon: "self_long",
        household: ["kids_now", "pets"],
        morning: "mid_2bath",
        budget: { range: [3_500_000, 6_000_000] },
        timeline: "normal",
        style: {
          refs: ["https://example.test/reference"],
          anti: ["глянец"],
          notes: "тёплый минимализм",
        },
        contact: {
          name: "Анна",
          phone: "+7 900 000-00-00",
          email: "anna@example.test",
          consent: true,
        },
        custom_0: "Нужна зона для занятий музыкой.",
        custom_14: "Последний допустимый вопрос студии.",
        comments: { vision: "Важно сохранить существующий паркет." },
        attachments: [
          {
            path: "project-id/plan.pdf",
            name: "План.pdf",
            size: 42_000,
            type: "application/pdf",
          },
        ],
      },
    };

    expect(parseInitialBriefInput(JSON.stringify(input))).toEqual(input);
  });

  it("enforces a hard UTF-8 byte cap before accepting a raw JSON body", () => {
    expect(INITIAL_BRIEF_INPUT_LIMITS.maxBodyBytes).toBe(64 * 1024);

    const oversized = body({
      vision: "я".repeat(INITIAL_BRIEF_INPUT_LIMITS.maxBodyBytes),
    });
    expect(new TextEncoder().encode(oversized).byteLength).toBeGreaterThan(
      INITIAL_BRIEF_INPUT_LIMITS.maxBodyBytes,
    );
    expect(() => parseInitialBriefInput(oversized)).toThrow();
  });

  it("rejects an oversized declared or streamed request before buffering it", async () => {
    const oversizedHeaders = new Headers({
      "content-length": String(INITIAL_BRIEF_INPUT_LIMITS.maxBodyBytes + 1),
    });
    expect(declaredInitialBriefRequestTooLarge(oversizedHeaders)).toBe(true);
    expect(
      declaredInitialBriefRequestTooLarge(
        new Headers({ "content-length": "invalid" }),
      ),
    ).toBe(true);
    expect(declaredInitialBriefRequestTooLarge(new Headers())).toBe(false);

    const oversizedChunk = new Uint8Array(
      INITIAL_BRIEF_INPUT_LIMITS.maxBodyBytes + 1,
    );
    const request = new Request("https://example.test/api/intake/submit", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(oversizedChunk);
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readBoundedInitialBriefBody(request)).rejects.toBeInstanceOf(
      InitialBriefRequestTooLargeError,
    );
  });

  it("requires a non-blank string token and caps its length", () => {
    expect(INITIAL_BRIEF_INPUT_LIMITS.maxTokenLength).toBe(256);

    for (const raw of [
      JSON.stringify({ answers: {} }),
      JSON.stringify({ token: "", answers: {} }),
      JSON.stringify({ token: "   ", answers: {} }),
      JSON.stringify({ token: 42, answers: {} }),
      body({}, "t".repeat(INITIAL_BRIEF_INPUT_LIMITS.maxTokenLength + 1)),
    ]) {
      expect(() => parseInitialBriefInput(raw)).toThrow();
    }

    expect(
      parseInitialBriefInput(
        body({}, "t".repeat(INITIAL_BRIEF_INPUT_LIMITS.maxTokenLength)),
      ).token,
    ).toHaveLength(INITIAL_BRIEF_INPUT_LIMITS.maxTokenLength);
  });

  it("requires answers to be a plain JSON object", () => {
    for (const answers of [undefined, null, [], "not-an-object", 7]) {
      const raw =
        answers === undefined
          ? JSON.stringify({ token: "brief-token-123" })
          : JSON.stringify({ token: "brief-token-123", answers });
      expect(() => parseInitialBriefInput(raw)).toThrow();
    }
  });

  it("allows only canonical questions, custom_0..custom_14, and comments", () => {
    const allAllowedAnswers = Object.fromEntries([
      ...QUESTIONS.map((question) => [question.id, null] as const),
      ...Array.from(
        { length: 15 },
        (_, index) => [`custom_${index}`, null] as const,
      ),
      ["comments", {}] as const,
    ]);

    expect(Object.keys(allAllowedAnswers)).toHaveLength(
      INITIAL_BRIEF_INPUT_LIMITS.maxAnswerKeys,
    );
    expect(parseInitialBriefInput(body(allAllowedAnswers)).answers).toEqual(
      allAllowedAnswers,
    );

    expect(() =>
      parseInitialBriefInput(body({ custom_15: "outside the contract" })),
    ).toThrow();
    expect(() =>
      parseInitialBriefInput(body({ injected_question: "not canonical" })),
    ).toThrow();
  });

  it("caps answer nesting, arrays, object properties, keys, and strings", () => {
    const {
      maxArrayLength,
      maxKeyLength,
      maxNestingDepth,
      maxObjectProperties,
      maxStringLength,
    } = INITIAL_BRIEF_INPUT_LIMITS;

    expect(parseInitialBriefInput(body({ comments: nestedAnswer(maxNestingDepth) }))).toBeTruthy();
    expect(() =>
      parseInitialBriefInput(
        body({ comments: nestedAnswer(maxNestingDepth + 1) }),
      ),
    ).toThrow();

    expect(
      parseInitialBriefInput(
        body({ zones: Array.from({ length: maxArrayLength }, () => "zone") }),
      ),
    ).toBeTruthy();
    expect(() =>
      parseInitialBriefInput(
        body({
          zones: Array.from({ length: maxArrayLength + 1 }, () => "zone"),
        }),
      ),
    ).toThrow();

    const maxProperties = Object.fromEntries(
      Array.from({ length: maxObjectProperties }, (_, index) => [
        `p${index}`,
        "value",
      ]),
    );
    const tooManyProperties = {
      ...maxProperties,
      overflow: "value",
    };
    expect(parseInitialBriefInput(body({ comments: maxProperties }))).toBeTruthy();
    expect(() =>
      parseInitialBriefInput(body({ comments: tooManyProperties })),
    ).toThrow();

    expect(
      parseInitialBriefInput(
        body({ comments: { ["k".repeat(maxKeyLength)]: "value" } }),
      ),
    ).toBeTruthy();
    expect(() =>
      parseInitialBriefInput(
        body({ comments: { ["k".repeat(maxKeyLength + 1)]: "value" } }),
      ),
    ).toThrow();

    expect(
      parseInitialBriefInput(body({ vision: "v".repeat(maxStringLength) })),
    ).toBeTruthy();
    expect(() =>
      parseInitialBriefInput(
        body({ vision: "v".repeat(maxStringLength + 1) }),
      ),
    ).toThrow();
  });

  it("rejects non-finite numbers, unsupported JSON-like values, and invalid JSON", () => {
    expect(() =>
      parseInitialBriefInput(
        '{"token":"brief-token-123","answers":{"object":{"area_m2":1e309}}}',
      ),
    ).toThrow();
    expect(() =>
      parseInitialBriefInput(
        '{"token":"brief-token-123","answers":{"vision":undefined}}',
      ),
    ).toThrow();
    expect(() => parseInitialBriefInput("{")).toThrow();
  });

  it("validates raw input before request identity derivation and AI reservation", () => {
    expect(routeSource).toMatch(/\bparseInitialBriefInput\b/);
    expect(routeSource).not.toMatch(/\brequest\.json\s*\(/);
    expect(routeSource).not.toMatch(/\brequest\.text\s*\(/);
    expect(routeSource).toMatch(/\bdeclaredInitialBriefRequestTooLarge\b/);
    expect(routeSource).toMatch(/\breadBoundedInitialBriefBody\b/);

    const validationCall = routeSource.search(/\bparseInitialBriefInput\s*\(/);
    const identityCall = routeSource.search(
      /\bderiveInitialBriefRequestIdentity\s*\(/,
    );
    const reservationCall = routeSource.search(/\breserveInitialBriefAiCall\s*\(/);

    expect(validationCall).toBeGreaterThanOrEqual(0);
    expect(identityCall).toBeGreaterThan(validationCall);
    expect(reservationCall).toBeGreaterThan(validationCall);
  });
});
