import { createHash } from "node:crypto";

export type R1ScanTerminal = "scan_failed" | "infected";
export interface R1ScanJob { readonly organizationId: string; readonly projectId: string; readonly intakeId: string; readonly checksumHex: string; readonly mediaType: string; readonly quarantineKey: string; readonly attempt: number; readonly idempotencyKey: string; }
export function createR1ScanJob(input: Omit<R1ScanJob, "idempotencyKey">): R1ScanJob {
  if (!/^[a-f0-9]{64}$/.test(input.checksumHex) || !Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt > 3 || !input.quarantineKey || !input.mediaType) throw new Error("r1_scan_job_invalid");
  const idempotencyKey = `r1_scan:${createHash("sha256").update([input.organizationId,input.projectId,input.intakeId,input.checksumHex,String(input.attempt)].join("\0")).digest("hex")}`;
  return { ...input, idempotencyKey };
}
export function resolveR1ScanWithoutApprovedEngine(_job: R1ScanJob): R1ScanTerminal { void _job; return "scan_failed"; }
