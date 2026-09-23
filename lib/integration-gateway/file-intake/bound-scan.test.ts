import { describe, expect, it, vi } from "vitest";
import { BoundFileScanWorker, fileScanDigest, type BoundScanClaim, type BoundScanExecution, type BoundScanEvidence, type BoundScanPorts } from "./bound-scan";

const ids = { task: "80111111-1111-4111-8111-111111111111", intake: "80222222-2222-4222-8222-222222222222",
  org: "80333333-3333-4333-8333-333333333333", project: "80444444-4444-4444-8444-444444444444", nonce: "80555555-5555-4555-8555-555555555555" };
const bytes = new TextEncoder().encode("%PDF-1.4 synthetic adapter control");
const checksum = fileScanDigest(bytes);
const input = { taskId: ids.task, capability: "a".repeat(64), leaseSecret: "b".repeat(64), claimKey: "claim-test", completionKey: "complete-test" };

function fixture() {
  const claimedAt = new Date(Date.now()-10000).toISOString();
  const claim: BoundScanClaim = { taskId: ids.task, intakeId: ids.intake, organizationId: ids.org,
    projectId: ids.project, packageId: ids.project, attempt: 1, fence: 1, nonce: ids.nonce,
    claimedAt, expiresAt: new Date(Date.parse(claimedAt)+300000).toISOString(), bucket: "client-uploads",
    objectKey: `project-intelligence/ru/${ids.org}/${ids.project}/quarantine/${ids.intake}/${checksum}/document.pdf`,
    canonicalKey: `project-intelligence/ru/${ids.org}/${ids.project}/sources/${checksum}/document.pdf`,
    checksumHex: checksum, byteLength: bytes.length, sourceRole: "document", extension: "pdf", mediaType: "application/pdf",
    policy: { policyVersion: "wp32-clamav-local17/v1", imageId: `sha256:${"1".repeat(64)}`, engineVersion: "1.5.4",
      executableSha256: "2".repeat(64), receiverSha256: "3".repeat(64), signatureBundleSha256: "4".repeat(64), signatureVersion: 1, signatureTimestamp: Math.floor(Date.now()/1000) },
  };
  const execution: BoundScanExecution = { taskId: ids.task, nonce: ids.nonce, attempt: 1, fence: 1,
    sourceSha256: checksum, byteLength: bytes.length, policy: claim.policy,
    scanStartedAt: new Date(Date.now()-5000).toISOString(), scanCompletedAt: new Date(Date.now()-2000).toISOString(),
    outcome: "clean", exitCode: 0, sandboxEvidenceSha256: "5".repeat(64) };
  const rpc = vi.fn(async (name: string) => ({ data: name === "claim_bound_file_scan"
    ? { operation: name, replay: false, result: claim }
    : { operation: name, replay: false, result: { taskId: ids.task, intakeId: ids.intake, receiptId: ids.nonce, evidenceDigest: "6".repeat(64), outcome: execution.outcome } }, error: null }));
  const ports = {
    readObject: vi.fn<BoundScanPorts["readObject"]>(async () => bytes),
    putCanonicalIfAbsent: vi.fn<BoundScanPorts["putCanonicalIfAbsent"]>(async () => {}),
    executeScanner: vi.fn<BoundScanPorts["executeScanner"]>(async () => execution),
    retainEvidence: vi.fn<BoundScanPorts["retainEvidence"]>(async () => {}),
  };
  const worker = new BoundFileScanWorker({ schema: () => ({ rpc }) }, ports);
  return { claim, execution, rpc, ports, worker };
}

describe("bound file scan SYSTEM adapter (synthetic ports, not scanner evidence)", () => {
  it("binds fresh scan and verified write-once canonical bytes before completing", async () => {
    const f = fixture(); const result = await f.worker.execute(input);
    expect(result.result.outcome).toBe("clean");
    expect(f.rpc.mock.calls.map(c => c[0])).toEqual(["claim_bound_file_scan", "claim_bound_file_scan", "complete_bound_file_scan"]);
    expect(f.ports.putCanonicalIfAbsent).toHaveBeenCalledWith("client-uploads", f.claim.canonicalKey, bytes, "application/pdf");
    const evidence = f.ports.retainEvidence.mock.calls[0]?.[0];
    expect(evidence).toMatchObject({ nonce: ids.nonce, sourceSha256: checksum, canonicalSha256: checksum, storageAfterSha256: checksum });
    expect(JSON.stringify(evidence)).not.toContain(input.capability);
    expect(JSON.stringify(evidence)).not.toContain(input.leaseSecret);
  });

  it("rejects stored bytes inconsistent with the claimed intake before scanner invocation", async () => {
    const f = fixture(); f.ports.readObject.mockResolvedValueOnce(new Uint8Array([1,2]));
    await expect(f.worker.execute(input)).rejects.toThrow("file_scan_stored_bytes_mismatch");
    expect(f.ports.executeScanner).not.toHaveBeenCalled(); expect(f.ports.retainEvidence).not.toHaveBeenCalled();
  });

  it.each(["nonce", "sourceSha256", "policy", "preclaim", "cleanExit"] as const)("rejects invalid execution binding: %s", async kind => {
    const f = fixture();
    const altered: BoundScanExecution = { ...f.execution,
      ...(kind === "nonce" ? { nonce: ids.org } : {}),
      ...(kind === "sourceSha256" ? { sourceSha256: "f".repeat(64) } : {}),
      ...(kind === "policy" ? { policy: { ...f.claim.policy, signatureVersion: 2 } } : {}),
      ...(kind === "preclaim" ? { scanStartedAt: new Date(Date.parse(f.claim.claimedAt)-1000).toISOString() } : {}),
      ...(kind === "cleanExit" ? { exitCode: 1 } : {}),
    };
    f.ports.executeScanner.mockResolvedValueOnce(altered);
    await expect(f.worker.execute(input)).rejects.toThrow("file_scan_execution_binding_invalid");
    expect(f.ports.putCanonicalIfAbsent).not.toHaveBeenCalled();
    expect(f.rpc.mock.calls.some(c=>c[0]==="complete_bound_file_scan")).toBe(false);
  });

  it("detects replacement during scanning", async () => {
    const f = fixture(); f.ports.readObject.mockResolvedValueOnce(bytes).mockResolvedValueOnce(new Uint8Array([9]));
    await expect(f.worker.execute(input)).rejects.toThrow("file_scan_stored_bytes_mismatch");
    expect(f.ports.putCanonicalIfAbsent).not.toHaveBeenCalled();
  });

  it("does not accept an existing but different canonical object", async () => {
    const f = fixture(); f.ports.readObject.mockResolvedValueOnce(bytes).mockResolvedValueOnce(bytes).mockResolvedValueOnce(new Uint8Array([9]));
    await expect(f.worker.execute(input)).rejects.toThrow("file_scan_stored_bytes_mismatch");
    expect(f.ports.retainEvidence).not.toHaveBeenCalled();
  });

  it("does not create a canonical copy for an infected result", async () => {
    const f = fixture(); f.execution.outcome = "infected"; f.execution.exitCode = 1;
    await f.worker.execute(input);
    expect(f.ports.putCanonicalIfAbsent).not.toHaveBeenCalled();
    expect(f.ports.retainEvidence.mock.calls[0]?.[0]).toMatchObject({ outcome:"infected",canonicalSha256:null,canonicalByteLength:null,canonicalVerifiedAt:null });
  });

  it("does not complete if evidence retention fails", async () => {
    const f = fixture(); f.ports.retainEvidence.mockRejectedValueOnce(new Error("evidence_store_unavailable"));
    await expect(f.worker.execute(input)).rejects.toThrow("evidence_store_unavailable");
    expect(f.rpc.mock.calls.some(c=>c[0]==="complete_bound_file_scan")).toBe(false);
  });

  it("keeps the full immutable measured evidence available for an identical retry", async () => {
    const f = fixture(); let retained: BoundScanEvidence | undefined;
    f.ports.retainEvidence.mockImplementation(async evidence => { retained = evidence; });
    await f.worker.execute(input);
    expect(retained).toBeDefined();
    if (!retained) throw new Error("missing_test_evidence");
    await f.worker.complete(input, retained);
    expect(f.ports.executeScanner).toHaveBeenCalledOnce();
    expect(f.rpc.mock.calls.filter(c=>c[0]==="complete_bound_file_scan")).toHaveLength(2);
  });
});
