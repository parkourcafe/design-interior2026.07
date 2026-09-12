export const R1_DELIVERY_CHUNK_BYTES = 256 * 1024;
export const R1_DELIVERY_RECHECK_MS = 1000;
export function assertR1DeliveryGrant(input: { readonly active: boolean; readonly requestedBytes: number }) {
  if (!input.active || !Number.isSafeInteger(input.requestedBytes) || input.requestedBytes < 1 || input.requestedBytes > R1_DELIVERY_CHUNK_BYTES) throw new Error("r1_delivery_grant_denied");
}
export function nextR1DeliveryRange(input: { readonly start: number; readonly totalBytes: number }) {
  if (!Number.isSafeInteger(input.start) || !Number.isSafeInteger(input.totalBytes) || input.start < 0 || input.start >= input.totalBytes) throw new Error("r1_delivery_range_invalid");
  return { start: input.start, endExclusive: Math.min(input.totalBytes, input.start + R1_DELIVERY_CHUNK_BYTES) };
}
