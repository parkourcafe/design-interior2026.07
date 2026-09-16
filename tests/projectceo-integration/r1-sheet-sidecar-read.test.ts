import { describe, expect, it } from "vitest";
import { ProjectCeoAuthenticatedReadPostgresAdapter } from "../../lib/project-intelligence/adapters/postgres/authenticated-read";
import type { PostgresRpcClient } from "../../lib/project-intelligence/adapters/postgres/contracts";
const id="abcdef00-0000-4000-8000-000000000001";
const input={projectId:id,packageId:id,sidecarId:id};
const result={sidecarId:id,schemaVersion:"r1-pdf-sheet-sidecar/1",confirmationId:id,sheetId:"Sheet-A",sheetRevisionId:"Rev-A",pdfAssetVersionId:id,pdfSha256:"a".repeat(64),pdfPageIndex:0,pdfCrop:{left:0,top:0,right:1,bottom:1},rotationDegrees:90,units:"mm",pageToPreviewTransform:[1,0,0,1,0,0],geometryEvidence:"architect_declared",pageMetadataVerification:"not_verified",createdAt:"2026-09-16T00:00:00.000000Z",conversionStatus:"unconfirmed",warning:"PDF предоставлен архитектором; DWG conversion не подтверждён"};
function fixture(patch: Record<string,unknown>={},error=false){
 const calls: unknown[]=[];
 const client: PostgresRpcClient={schema:(schema)=>({rpc:async(name,args)=>{calls.push({schema,name,args});return error?{data:null,error:{code:"P1103",message:"private"}}:{data:{contractVersion:"r1-sheet-sidecar-read/1",result:{...result,...patch}},error:null};}})};
 return {calls,adapter:new ProjectCeoAuthenticatedReadPostgresAdapter(client)};
}
describe("source-pair historical metadata read",()=>{
 it("sends only canonical exact selectors and returns strict immutable facts",async()=>{const f=fixture();expect(await f.adapter.getPdfDwgSheetSidecar({projectId:id.toUpperCase(),packageId:id.toUpperCase(),sidecarId:id.toUpperCase()},"true")).toEqual({contractVersion:"r1-sheet-sidecar-read/1",result});expect(f.calls).toEqual([{schema:"projectceo_read_api",name:"get_pdf_dwg_sheet_sidecar",args:{project_id:id,package_id:id,sidecar_id:id}}]);});
 it("module-off does not reach RPC",async()=>{const f=fixture();await expect(f.adapter.getPdfDwgSheetSidecar(input,"false")).rejects.toThrow();expect(f.calls).toEqual([]);});
 it.each([{reason:"private"},{architectUserId:id},{privateLocator:"private"},{generationId:id},{conversionStatus:"confirmed"},{warning:""},{sidecarId:"abcdef00-0000-4000-8000-000000000009"},{pdfSha256:"bad"},{geometryEvidence:"verified"},{pageMetadataVerification:"verified"},{pageToPreviewTransform:[1,2,2,4,0,0]}])("rejects unsafe output %j",async(patch)=>{const f=fixture(patch);await expect(f.adapter.getPdfDwgSheetSidecar(input,"true")).rejects.toThrow();});
 it("maps database denial",async()=>{const f=fixture({},true);await expect(f.adapter.getPdfDwgSheetSidecar(input,"true")).rejects.toMatchObject({code:"forbidden"});});
 it("rejects invalid UUID before network",async()=>{const f=fixture();await expect(f.adapter.getPdfDwgSheetSidecar({...input,sidecarId:"invalid"},"true")).rejects.toThrow();expect(f.calls).toEqual([]);});
});
