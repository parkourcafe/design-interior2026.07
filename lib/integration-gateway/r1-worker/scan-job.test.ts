import { describe, expect, it } from "vitest";
import { createR1ScanJob, resolveR1ScanWithoutApprovedEngine } from "./scan-job";
describe("R1 scan job", () => { it("is deterministic and fails closed without an engine", () => { const job=createR1ScanJob({organizationId:"o",projectId:"p",intakeId:"i",checksumHex:"a".repeat(64),mediaType:"application/octet-stream",quarantineKey:"opaque",attempt:1}); expect(job.idempotencyKey).toMatch(/^r1_scan:/); expect(resolveR1ScanWithoutApprovedEngine(job)).toBe("scan_failed"); }); });

describe("R1 scan retry budget", () => {
  const input = { organizationId: "o", projectId: "p", intakeId: "i", checksumHex: "a".repeat(64), mediaType: "application/octet-stream", quarantineKey: "opaque" };
  it.each([NaN, Infinity, -Infinity, 0, -1, 1.5, 2.5, 4, Number.MAX_SAFE_INTEGER + 1])("rejects invalid attempt %s", (attempt) => {
    expect(() => createR1ScanJob({ ...input, attempt })).toThrow("r1_scan_job_invalid");
  });
  it("permits exactly three distinct, replay-stable attempt keys", () => {
    const keys = [1, 2, 3].map(attempt => {
      const job = createR1ScanJob({ ...input, attempt });
      expect(createR1ScanJob({ ...input, attempt }).idempotencyKey).toBe(job.idempotencyKey);
      return job.idempotencyKey;
    });
    expect(new Set(keys).size).toBe(3);
  });
});
