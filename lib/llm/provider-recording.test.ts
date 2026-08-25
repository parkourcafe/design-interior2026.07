import { beforeEach, describe, expect, it, vi } from "vitest";

// Провайдер подменяется целиком: completeJSON выбирает его по LLM_PROVIDER.
const completeMock = vi.fn();
vi.mock("./yandex", () => ({
  completeYandex: (prompt: string) => completeMock(prompt),
}));

// Учёт ловим на границе модуля: рекордер мокаем, содержимое проверяем.
const recordMock = vi.fn();
vi.mock("./recording", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./recording")>()),
  recordAiCallBestEffort: (input: unknown) => recordMock(input),
}));

import { completeJSON } from "./provider";
import { z } from "zod";

const schema = z.object({ answer: z.string() });

beforeEach(() => {
  completeMock.mockReset();
  recordMock.mockReset();
  process.env.LLM_PROVIDER = "yandex";
  delete process.env.LLM_MODEL;
});

describe("completeJSON — учёт вызовов AI (DEC-009, A2)", () => {
  it("успешный вызов пишет ровно одну запись ok с длинами и хешем промпта", async () => {
    completeMock.mockResolvedValue('{"answer":"да"}');

    const result = await completeJSON('Вопрос про ремонт?', schema, {
      module: "brief",
      purpose: "custom_question",
    });

    expect(result.ok).toBe(true);
    expect(recordMock).toHaveBeenCalledTimes(1);
    const entry = recordMock.mock.calls[0]?.[0];
    expect(entry).toMatchObject({
      provider: "yandex",
      model: "yandexgpt-lite",
      status: "ok",
      errorCode: null,
      completionText: '{"answer":"да"}',
    });
    expect(entry.prompt).toBe("Вопрос про ремонт?");
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    // В записи нет текста ответа провайдера целиком — только то, что
    // рекордер положит в базу (длины и хеш) — см. recording.ts.
  });

  it("отказ провайдера пишет запись error со слагом кода без тела", async () => {
    completeMock.mockRejectedValue(
      new Error("yandex_http_429: quota exceeded, prompt echo: секретные данные"),
    );

    const result = await completeJSON("промпт", schema, {
      module: "risks",
      purpose: "risk_cards",
    });

    expect(result.ok).toBe(false);
    expect(recordMock).toHaveBeenCalledTimes(1);
    const entry = recordMock.mock.calls[0]?.[0];
    expect(entry?.status).toBe("error");
    // Тело ответа провайдера (может нести эхо промпта) в код не попадает.
    expect(entry.errorCode).toBe("yandex_http_429");
    expect(entry.completionText).toBeNull();
  });

  it("repair-retry пишет ДВЕ записи, обе ok", async () => {
    completeMock
      .mockResolvedValueOnce("мусор без json")
      .mockResolvedValueOnce('{"answer":"починено"}');

    const result = await completeJSON("промпт", schema);

    expect(result).toMatchObject({ ok: true, repaired: true });
    expect(recordMock).toHaveBeenCalledTimes(2);
    expect(recordMock.mock.calls[0]?.[0].status).toBe("ok");
    expect(recordMock.mock.calls[1]?.[0].status).toBe("ok");
    // Вторая запись — про repair-промпт, не про исходный.
    expect(recordMock.mock.calls[1]?.[0].prompt).toContain("не прошёл валидацию");
  });

  it("падение учёта не роняет основной вызов (best-effort)", async () => {
    completeMock.mockResolvedValue('{"answer":"да"}');
    recordMock.mockRejectedValue(new Error("recorder down"));

    const result = await completeJSON("промпт", schema);

    expect(result.ok).toBe(true);
    expect(recordMock).toHaveBeenCalledTimes(1);
  });

  it("контекст (module/purpose) доходит до записи", async () => {
    completeMock.mockResolvedValue('{"answer":"да"}');

    await completeJSON("промпт", schema, {
      module: "platform",
      purpose: "unit_probe",
      organizationId: "org-1",
    });

    const entry = recordMock.mock.calls[0]?.[0];
    expect(entry?.ctx).toEqual({
      module: "platform",
      purpose: "unit_probe",
      organizationId: "org-1",
    });
  });
});
