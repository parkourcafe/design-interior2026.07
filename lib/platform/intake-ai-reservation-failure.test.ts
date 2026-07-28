import { expect, it, vi } from "vitest";

import { executeReservedInitialBriefAiCall } from "./intake-ai-reservation";

it("closes the reservation once and rethrows the original error when the provider fails", async () => {
  const observedOrder: string[] = [];
  const reservation = { id: "reservation-1" };
  const providerError = new Error("provider failed");

  const reserve = vi.fn(async () => {
    observedOrder.push("reserve");
    return reservation;
  });
  const executeProvider = vi.fn(async (): Promise<string> => {
    observedOrder.push("provider");
    throw providerError;
  });
  const closeReservation = vi.fn(
    async (_input: {
      reservation: typeof reservation;
      error: unknown;
      providerCompleted: boolean;
    }) => {
      observedOrder.push("close");
    },
  );
  const recordUsage = vi.fn(async () => undefined);
  const finalizeReservation = vi.fn(async () => undefined);

  await expect(
    executeReservedInitialBriefAiCall({
      reserve,
      executeProvider,
      closeReservation,
      recordUsage,
      finalizeReservation,
    }),
  ).rejects.toBe(providerError);

  expect(closeReservation).toHaveBeenCalledTimes(1);
  const [closeInput] = closeReservation.mock.calls[0]!;
  expect(closeInput.reservation).toBe(reservation);
  expect(closeInput.error).toBe(providerError);
  expect(closeInput.providerCompleted).toBe(false);
  expect(observedOrder).toEqual(["reserve", "provider", "close"]);
  expect(recordUsage).not.toHaveBeenCalled();
  expect(finalizeReservation).not.toHaveBeenCalled();
});
