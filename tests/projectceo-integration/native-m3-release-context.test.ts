import { describe, expect, it, vi } from "vitest";
import { ProjectCeoM3HumanPostgresAdapter } from "../../lib/project-intelligence/adapters/postgres/documentation";

const uuid=(n:number)=>`91000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const selector={projectId:uuid(1),packageId:uuid(2)};
function fixture() {
  const layout={documentId:"layout",versionId:"layout-v1",revisionId:"layout-r1",semanticHash:`sha256:${"1".repeat(64)}`};
  const data={schemaVersion:"remhaos.native-m3-release-context/1",scope:{organizationId:uuid(3),...selector},stateRevision:7,baselineId:"baseline-1",previousVersionId:null,
    handoffs:[{handoffId:"handoff",revisionId:"handoff-r1",revisionNo:1,contractVersion:"archidom.m2-to-m3-handoff/0.1",
      packageId:selector.packageId,roomId:"room-1",approvedM2CommitRevisionId:"approved-r1",designIntentRevisionId:"design-r1",
      layout,selectionRevisionIds:["selection-r1"]}],
    sheets:[{sheetId:"sheet-1",packageId:selector.packageId,roomId:"room-1",sheetNumber:"A-01",title:"Synthetic unit sheet",
      revisionId:"sheet-r1",revisionNo:1,specificationRevisionIds:["selection-r1"],origin:{handoffId:"handoff",handoffRevisionId:"handoff-r1",
        handoffContractVersion:"archidom.m2-to-m3-handoff/0.1",approvedM2CommitRevisionId:"approved-r1",designIntentRevisionId:"design-r1",
        layoutDocumentId:layout.documentId,layoutVersionId:layout.versionId,layoutRevisionId:layout.revisionId,semanticHash:layout.semanticHash}}],
    baselineDecisionRevisionIds:["design-r1"],baselineSelectionRevisionIds:["selection-r1"],
    findings:[] as {code:string;subject:string}[],structurallyComplete:true,contextDigest:`sha256:${"2".repeat(64)}`};
  const rpc=vi.fn(async()=>({data:{requestId:`db:${uuid(4)}`,data,error:null},error:null}));
  const schema=vi.fn(()=>({rpc}));
  return {data,rpc,schema,adapter:new ProjectCeoM3HumanPostgresAdapter({schema})};
}
describe("native M3 release context read adapter (synthetic transport)",()=>{
  it("calls only the request-bound M3 read RPC and preserves its server digest",async()=>{
    const f=fixture();const result=await f.adapter.getNativeReleaseContext(selector);
    expect(f.schema).toHaveBeenCalledWith("projectceo_m3_api");
    expect(f.rpc).toHaveBeenCalledWith("get_native_m3_release_context",{project_id:selector.projectId,package_id:selector.packageId});
    expect(result.data.contextDigest).toBe(f.data.contextDigest);
    expect(f.rpc).toHaveBeenCalledOnce();
  });
  it("does not translate structural findings into publication success",async()=>{
    const f=fixture();f.data.findings=[{code:"SPECIFICATION_NOT_COVERED",subject:"selection-r1"}];f.data.structurallyComplete=false;
    expect((await f.adapter.getNativeReleaseContext(selector)).data.structurallyComplete).toBe(false);
  });
  it.each(["project","package","handoff","sheet"])("rejects foreign %s scope",async field=>{
    const f=fixture();
    if(field==="project")f.data.scope.projectId=uuid(99);
    if(field==="package")f.data.scope.packageId=uuid(99);
    if(field==="handoff")f.data.handoffs[0]!.packageId=uuid(99);
    if(field==="sheet")f.data.sheets[0]!.packageId=uuid(99);
    await expect(f.adapter.getNativeReleaseContext(selector)).rejects.toThrow("native_m3_release_context_scope_mismatch");
  });
  it("rejects complete=true alongside a finding",async()=>{
    const f=fixture();f.data.findings=[{code:"HANDOFF_REQUIRED",subject:selector.packageId}];
    await expect(f.adapter.getNativeReleaseContext(selector)).rejects.toThrow("native_m3_release_context_inconsistent");
  });
  it("rejects an empty handoff inventory labelled complete",async()=>{
    const f=fixture();f.data.handoffs=[];
    await expect(f.adapter.getNativeReleaseContext(selector)).rejects.toThrow("native_m3_release_context_inconsistent");
  });
  it("rejects malformed server hashes without exposing payload details",async()=>{
    const f=fixture();f.data.contextDigest="not-a-digest";
    await expect(f.adapter.getNativeReleaseContext(selector)).rejects.toThrow("native_m3_release_context_invalid");
  });
  it("refuses a project-root selector before sending an RPC",async()=>{
    const f=fixture();await expect(f.adapter.getNativeReleaseContext({...selector,packageId:selector.projectId})).rejects.toThrow("native_m3_work_package_required");
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
