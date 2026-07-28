import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("Sprint 1 RU LLM provider guardrail", () => {
  it("keeps runtime selection limited to YandexGPT and GigaChat", () => {
    const provider = read("lib/llm/provider.ts");
    const yandex = read("lib/llm/yandex.ts");
    const actions = read("app/dashboard/projects/[id]/actions.ts");
    const health = read("app/api/health/route.ts");
    const envExample = read(".env.example");

    expect(provider).not.toMatch(/\bcompleteZai\b|["']zai["']/i);
    expect(actions).not.toMatch(/["']zai["']/i);
    expect(health).not.toMatch(/\bZAI_API_KEY\b|["']zai["']/i);
    expect(envExample).not.toMatch(/\bZAI_(?:API_KEY|BASE_URL)\b|LLM_PROVIDER=zai/i);
    expect(yandex).toMatch(/\bsignal\s*:\s*AbortSignal\.timeout\s*\(/);
  });
});
