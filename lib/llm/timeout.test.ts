import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { completeZai } from "./zai";
import { completeYandex } from "./yandex";
import { completeJSON } from "./provider";
import { providerErrorCode } from "./recording";

// Аудит 28.09, шаг 5: зависший провайдер AI не держит запрос бесконечно.
// fetch подменён «вечным» ответом, который завершается только по сигналу
// отмены, — так проверяется именно таймаут, а не быстрый отказ.

const realFetch = globalThis.fetch;

function hangingFetch(): typeof fetch {
  return ((_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // без сигнала — висим навсегда (старое поведение)
      signal.addEventListener("abort", () => reject(signal.reason));
    })) as typeof fetch;
}

beforeEach(() => {
  process.env.LLM_TIMEOUT_MS = "150";
  process.env.LLM_TOTAL_BUDGET_MS = "400";
  process.env.ZAI_API_KEY = "test-key";
  process.env.YC_FOLDER_ID = "folder";
  process.env.YC_API_KEY = "test-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  globalThis.fetch = hangingFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.LLM_TIMEOUT_MS;
  delete process.env.LLM_TOTAL_BUDGET_MS;
  delete process.env.LLM_PROVIDER;
});

describe("AI provider timeout", () => {
  it("aborts a hanging z.ai call after LLM_TIMEOUT_MS", async () => {
    const started = Date.now();
    const error = await completeZai("prompt").catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(providerErrorCode(error)).toBe("llm_timeout");
  });

  it("aborts a hanging YandexGPT call after LLM_TIMEOUT_MS", async () => {
    const error = await completeYandex("prompt").catch((e: unknown) => e);
    expect(providerErrorCode(error)).toBe("llm_timeout");
  });

  it("completeJSON returns an error within the total budget so callers fall back to rules", async () => {
    process.env.LLM_PROVIDER = "zai";
    const started = Date.now();
    const result = await completeJSON("prompt", z.object({ a: z.string() }));
    expect(result.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("does not start the repair call when the budget is spent", async () => {
    process.env.LLM_PROVIDER = "zai";
    process.env.LLM_TIMEOUT_MS = "300";
    process.env.LLM_TOTAL_BUDGET_MS = "350";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
      return new Response(JSON.stringify({ choices: [{ message: { content: "не JSON" } }] }), { status: 200 });
    }) as typeof fetch;
    const result = await completeJSON("prompt", z.object({ a: z.string() }));
    expect(result).toEqual({ ok: false, error: "llm_budget_exhausted" });
    expect(calls).toBe(1);
  });
});

describe("risk pipeline falls back to rule cards when AI times out", () => {
  it("returns a passport and rule cards with llmOk=false", async () => {
    vi.resetModules();
    process.env.LLM_PROVIDER = "zai";
    const { runRiskPipeline } = await import("../brief/pipeline");
    const result = await runRiskPipeline({
      object: { type: "flat", area_m2: 60, city: "Казань" },
      morning: "high",
      bath_count: "1",
    });
    expect(result.llmOk).toBe(false);
    expect(result.passport).toBeTruthy();
    expect(Array.isArray(result.cards)).toBe(true);
  });
});
