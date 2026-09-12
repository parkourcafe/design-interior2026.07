import { describe, expect, it } from "vitest";
import { R1_DELIVERY_CHUNK_BYTES, assertR1DeliveryGrant, nextR1DeliveryRange } from "./broker";
describe("R1 delivery broker", () => { it("bounds every chunk and fails after revoke", () => { expect(nextR1DeliveryRange({start:0,totalBytes:R1_DELIVERY_CHUNK_BYTES+1}).endExclusive).toBe(R1_DELIVERY_CHUNK_BYTES); expect(() => assertR1DeliveryGrant({active:false,requestedBytes:1})).toThrow("r1_delivery_grant_denied"); }); });
