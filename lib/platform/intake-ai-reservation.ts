type ReservationCloseInput<TReservation> = {
  reservation: TReservation;
  error: unknown;
  providerCompleted: boolean;
};

export async function executeReservedInitialBriefAiCall<
  TReservation,
  TProviderResult,
>(input: {
  reserve: () => Promise<TReservation>;
  executeProvider: () => Promise<TProviderResult>;
  closeReservation?: (
    input: ReservationCloseInput<TReservation>,
  ) => Promise<unknown>;
  recordUsage?: () => Promise<unknown>;
  finalizeReservation?: () => Promise<unknown>;
}): Promise<TProviderResult> {
  const reservation = await input.reserve();

  try {
    return await input.executeProvider();
  } catch (error) {
    try {
      await input.closeReservation?.({
        reservation,
        error,
        providerCompleted: false,
      });
    } catch {
      // Preserve the provider failure as the primary error for the caller.
    }

    throw error;
  }
}
