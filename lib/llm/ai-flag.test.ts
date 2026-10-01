import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { isAiEnabled } from "./ai-flag";
import { completeJSON } from "./provider";
import { zaiGlmOcr } from "@/lib/brief/plan-file-text";
import { runRiskPipeline } from "@/lib/brief/pipeline";

// Решение владельца 01.10.2026: на время пилота AI выключен. Ни анкета, ни план
// не должны уходить ни к одному провайдеру, даже если ключи заданы.
const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  delete process.env.REMHAOS_AI_ENABLED;
  process.env.LLM_PROVIDER = "zai";
  process.env.ZAI_API_KEY = "configured-key";
  process.env.YC_FOLDER_ID = "folder";
  process.env.YC_API_KEY = "configured-key";
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ["LLM_PROVIDER", "ZAI_API_KEY", "YC_FOLDER_ID", "YC_API_KEY", "REMHAOS_AI_ENABLED"]) delete process.env[k];
});

describe("AI is off unless REMHAOS_AI_ENABLED=true", () => {
  it("reads only the exact value true", () => {
    expect(isAiEnabled(undefined)).toBe(false);
    expect(isAiEnabled("1")).toBe(false);
    expect(isAiEnabled("TRUE")).toBe(false);
    expect(isAiEnabled("true")).toBe(true);
  });

  it("completeJSON makes no network call when AI is off, even with keys set", async () => {
    const result = await completeJSON("prompt", z.object({ a: z.string() }));
    expect(result).toEqual({ ok: false, error: "ai_disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("OCR sends no file when AI is off, even with ZAI_API_KEY set", async () => {
    const result = await zaiGlmOcr(new File(["img"], "plan.png", { type: "image/png" }));
    expect(result).toMatchObject({ status: "unsupported", message: "ai_disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the brief still produces rule cards without AI", async () => {
    const { cards, llmOk } = await runRiskPipeline({
      object: { type: "flat", area_m2: 40, city: "Москва" },
      morning: { people: 3, bathrooms: 1 },
    } as never);
    expect(llmOk).toBe(false);
    expect(Array.isArray(cards)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an unknown LLM_PROVIDER is refused instead of falling back to Yandex", async () => {
    process.env.REMHAOS_AI_ENABLED = "true";
    process.env.LLM_PROVIDER = "none";
    const result = await completeJSON("prompt", z.object({ a: z.string() }));
    expect(result).toEqual({ ok: false, error: "llm_provider_unknown" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
