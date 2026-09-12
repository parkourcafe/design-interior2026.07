import { describe, expect, it } from "vitest";
import { planR1Retention } from "./r1-lifecycle";
describe("R1 retention planner", () => { it("never deletes and preserves holds/references", () => { expect(planR1Retention({hold:true,referenceCount:0,retentionUntil:"2020-01-01T00:00:00Z",now:"2026-01-01T00:00:00Z"})).toBe("hold"); expect(planR1Retention({hold:false,referenceCount:1,retentionUntil:"2020-01-01T00:00:00Z",now:"2026-01-01T00:00:00Z"})).toBe("shared_reference"); }); });
