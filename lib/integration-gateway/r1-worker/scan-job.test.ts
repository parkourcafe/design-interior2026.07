import { describe, expect, it } from "vitest";
import { createR1ScanJob, resolveR1ScanWithoutApprovedEngine } from "./scan-job";
describe("R1 scan job", () => { it("is deterministic and fails closed without an engine", () => { const job=createR1ScanJob({organizationId:"o",projectId:"p",intakeId:"i",checksumHex:"a".repeat(64),mediaType:"application/octet-stream",quarantineKey:"opaque",attempt:1}); expect(job.idempotencyKey).toMatch(/^r1_scan:/); expect(resolveR1ScanWithoutApprovedEngine(job)).toBe("scan_failed"); }); });
