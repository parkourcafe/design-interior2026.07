import { describe, expect, it, vi } from "vitest";
import { executeReservedInitialBriefAiCall } from "./intake-ai-reservation";

describe("executeReservedInitialBriefAiCall", () => {
  it("attempts the durable reservation first and fails closed without executing the provider when reservation fails", async () => {
    const calls: string[] = [];
    const reservationError = new Error("reservation failed");
    const reserve = vi.fn(async () => {
      calls.push("reserve");
      throw reservationError;
    });
    const executeProvider = vi.fn(async () => {
      calls.push("executeProvider");
      return "provider result";
    });

    await expect(
      executeReservedInitialBriefAiCall({ reserve, executeProvider }),
    ).rejects.toBe(reservationError);

    expect(calls).toEqual(["reserve"]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(executeProvider).not.toHaveBeenCalled();
  });
});
