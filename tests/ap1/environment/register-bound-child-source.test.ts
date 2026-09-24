import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { registerBoundChildSource } from "./register-bound-child-source";
import type { BoundScanClaim, BoundScanEvidence } from "../../../lib/integration-gateway/file-intake/bound-scan";

const id=(n:number)=>`90000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function fixture() {
  const bytes = new TextEncoder().encode("%PDF-1.4 synthetic child-source unit fixture");
  const checksum=createHash("sha256").update(bytes).digest("hex");
  const policy={policyVersion:"wp32-clamav-local17/v1" as const,imageId:`sha256:${"a".repeat(64)}`,engineVersion:"1.5.4" as const,
    executableSha256:"b".repeat(64),receiverSha256:"c".repeat(64),signatureBundleSha256:"d".repeat(64),signatureVersion:1,signatureTimestamp:1};
  const claim:BoundScanClaim={organizationId:id(1),projectId:id(2),packageId:id(2),taskId:id(3),intakeId:id(4),
    attempt:1,fence:1,nonce:id(5),claimedAt:"2026-09-23T00:00:00Z",expiresAt:"2026-09-23T00:05:00Z",bucket:"client-uploads",
    objectKey:`project-intelligence/ru/${id(1)}/${id(2)}/quarantine/${id(4)}/${checksum}/document.pdf`,
    canonicalKey:`project-intelligence/ru/${id(1)}/${id(2)}/sources/${checksum}/document.pdf`,checksumHex:checksum,
    byteLength:bytes.length,sourceRole:"document",extension:"pdf",mediaType:"application/pdf",policy};
  const evidence:BoundScanEvidence={schemaVersion:"remhaos.file-scan-evidence/1",taskId:claim.taskId,nonce:claim.nonce,attempt:1,fence:1,
    sourceSha256:checksum,byteLength:bytes.length,policy,scanStartedAt:claim.claimedAt,scanCompletedAt:"2026-09-23T00:01:00Z",
    outcome:"clean",exitCode:0,sandboxEvidenceSha256:"e".repeat(64),storageAfterSha256:checksum,canonicalSha256:checksum,
    canonicalByteLength:bytes.length,canonicalVerifiedAt:"2026-09-23T00:01:01Z"};
  const completion={taskId:claim.taskId,intakeId:claim.intakeId,receiptId:id(6),evidenceDigest:"f".repeat(64),outcome:"clean" as const};
  const input={projectId:id(2),packageId:id(7),physicalRecordId:id(8),alias:"source-1.pdf",sourceRevisionId:"source-revision-1",key:"unit-child",
    bytes,claim,evidence,completion,area:undefined as undefined|{nodeId:string;revisionId:string;title:string;payload:Record<string,unknown>},
    dependencyTargetNodeId:undefined as string|undefined};
  const counts=new Map<string,number>();
  const rpc=vi.fn(async(name:string,args:Readonly<Record<string,unknown>>={})=>{
    if(name==="authorize_source_upload")return {data:{data:{projectId:input.projectId,packageId:input.packageId,bucket:"client-uploads",
      objectKey:claim.canonicalKey,checksum,mediaType:claim.mediaType,upsert:false}},error:null};
    if(name==="list_projects")return {data:{data:[{projectId:input.projectId,stateRevision:counts.size}]},error:null};
    const count=counts.get(name)??0;counts.set(name,count+1);
    return {data:{operation:name,replay:count>0,stateRevision:3,result:{id:name,requestKey:args.idempotency_key,
      sourceId:`source-sha256-${checksum.slice(0,24)}`,sourceRevisionId:input.sourceRevisionId,packageId:input.packageId}},error:null};
  });
  const ports={confirmCompletion:vi.fn(async()=>completion),readCanonical:vi.fn(async()=>bytes),retainObservation:vi.fn(async()=>{}),
    measureAnchor:vi.fn(async()=>({sourceSha256:checksum,method:"synthetic-unit-parser",locator:{kind:"pdf",page:1}}))};
  return {input,ports,rpc,client:{schema:()=>({rpc})}};
}
describe("child source ingestion from a verified scan (synthetic unit ports only)",()=>{
  it("uses only human RPC writes, actual size, child scope, unknown status and exact replay",async()=>{
    const f=fixture();const result=await registerBoundChildSource(f.client,f.input,f.ports);
    expect(result.packageId).toBe(f.input.packageId);
    expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(["authorize_source_upload","list_projects","register_source_inventory","register_source_inventory",
      "list_projects","ingest_source_graph","ingest_source_graph"]);
    expect(f.ports.confirmCompletion).toHaveBeenCalledWith(f.input.evidence);
    const graph=f.rpc.mock.calls.find(c=>c[0]==="ingest_source_graph")?.[1];
    expect(graph).toMatchObject({source:{packageId:f.input.packageId,checksumHex:f.input.claim.checksumHex,
      metadata:{sizeBytes:f.input.bytes.length,documentStatus:"unknown"}},
      fragments:[{sourceId:result.sourceId,locatorKind:"pdf",locator:{kind:"pdf",page:1}}],
      evidence_links:[{nodeRevisionId:f.input.sourceRevisionId,sourceFragmentId:result.fragmentId}],edges:[]});
    expect(JSON.stringify(graph)).not.toContain("sizeBytes\":1,");
  });
  it("binds an optional extracted area revision to the same measured source fragment",async()=>{
    const f=fixture();
    f.input.area={nodeId:"area-source-bound",revisionId:"area-source-bound-r1",title:"Source-bound area",
      payload:{schemaVersion:"project-ceo/area/0.1",name:"Measured source scope"}};
    f.input.dependencyTargetNodeId="decision-source-bound";
    const result=await registerBoundChildSource(f.client,f.input,f.ports);
    const graph=f.rpc.mock.calls.find(c=>c[0]==="ingest_source_graph")?.[1] as Record<string,unknown>;
    expect(graph).toMatchObject({
      nodes:expect.arrayContaining([expect.objectContaining({nodeId:"area-source-bound",kind:"area",currentRevisionId:"area-source-bound-r1"})]),
      revisions:expect.arrayContaining([expect.objectContaining({revisionId:"area-source-bound-r1",nodeId:"area-source-bound",claimStatus:"extracted"})]),
      evidence_links:expect.arrayContaining([expect.objectContaining({evidenceLinkId:result.areaEvidenceLinkId,
        nodeRevisionId:"area-source-bound-r1",sourceFragmentId:result.fragmentId})]),
      edges:[{edgeId:`dependency-${f.input.physicalRecordId}`,fromNodeId:`node-${result.sourceId}`,
        toNodeId:"decision-source-bound",relation:"depends_on"}],
    });
  });
  it.each(["scope","bytes","verdict","canonical"])("rejects invalid %s before business writes",async kind=>{
    const f=fixture();
    if(kind==="scope")f.input.packageId=f.input.projectId;
    if(kind==="bytes")f.input.bytes=new Uint8Array([1]);
    if(kind==="verdict")f.input.evidence.outcome="scan_failed";
    if(kind==="canonical")f.input.evidence={...f.input.evidence,canonicalSha256:"0".repeat(64)};
    await expect(registerBoundChildSource(f.client,f.input,f.ports)).rejects.toThrow();expect(f.rpc).not.toHaveBeenCalled();
  });
  it("does not register if current server authorization is denied",async()=>{
    const f=fixture();f.rpc.mockRejectedValueOnce(new Error("forbidden"));
    await expect(registerBoundChildSource(f.client,f.input,f.ports)).rejects.toThrow("forbidden");
    expect(f.ports.readCanonical).not.toHaveBeenCalled();
  });
  it("does not register bytes whose canonical object changed",async()=>{
    const f=fixture();f.ports.readCanonical.mockResolvedValueOnce(new Uint8Array([8]));
    await expect(registerBoundChildSource(f.client,f.input,f.ports)).rejects.toThrow("CHILD_SOURCE_CANONICAL_CHANGED");
    expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(["authorize_source_upload"]);
  });
  it("does not trust a different persisted completion",async()=>{
    const f=fixture();f.ports.confirmCompletion.mockResolvedValueOnce({...f.input.completion,receiptId:id(99)});
    await expect(registerBoundChildSource(f.client,f.input,f.ports)).rejects.toThrow("CHILD_SOURCE_COMPLETION_CHANGED");
    expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(["authorize_source_upload"]);
  });
  it("rejects a physical locator measured from other bytes",async()=>{
    const f=fixture();f.ports.measureAnchor.mockResolvedValueOnce({sourceSha256:"0".repeat(64),method:"synthetic-unit-parser",locator:{kind:"pdf",page:1}});
    await expect(registerBoundChildSource(f.client,f.input,f.ports)).rejects.toThrow("CHILD_SOURCE_ANCHOR_UNBOUND");
    expect(f.rpc.mock.calls.some(c=>c[0]==="register_source_inventory")).toBe(false);
  });
  it("rejects a receipt for another intake even when task IDs match",async()=>{
    const f=fixture();f.input.completion.intakeId=id(99);
    await expect(registerBoundChildSource(f.client,f.input,f.ports)).rejects.toThrow("CHILD_SOURCE_SCAN_BINDING_INVALID");
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("rejects server coordinates for another child",async()=>{
    const f=fixture();f.rpc.mockResolvedValueOnce({data:{data:{projectId:f.input.projectId,packageId:id(99),bucket:"client-uploads",
      objectKey:f.input.claim.canonicalKey,checksum:f.input.claim.checksumHex,mediaType:f.input.claim.mediaType,upsert:false}},error:null});
    await expect(registerBoundChildSource(f.client,f.input,f.ports)).rejects.toThrow("CHILD_SOURCE_AUTHORIZATION_MISMATCH");
    expect(f.ports.confirmCompletion).not.toHaveBeenCalled();
  });
  it("rejects a mutation retry with a changed result and never proceeds to ingestion",async()=>{
    const f=fixture();const original=f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async(name,args)=>{
      const response=await original(name,args);
      if(name==="register_source_inventory"&&"replay" in response.data&&response.data.replay) return {...response,data:{...response.data,result:{...response.data.result,id:"changed"}}};
      return response;
    });
    await expect(registerBoundChildSource(f.client,f.input,f.ports)).rejects.toThrow("CHILD_SOURCE_REPLAY_MISMATCH");
    expect(f.rpc.mock.calls.some(c=>c[0]==="ingest_source_graph")).toBe(false);
  });
});
