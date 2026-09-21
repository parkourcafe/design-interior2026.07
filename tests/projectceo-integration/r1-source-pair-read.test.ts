import { describe, expect, it } from "vitest";
import { ProjectCeoAuthenticatedReadPostgresAdapter } from "../../lib/project-intelligence/adapters/postgres/authenticated-read";
import type { PostgresRpcClient } from "../../lib/project-intelligence/adapters/postgres/contracts";
const id="abcdef00-0000-4000-8000-000000000001";
const input={projectId:id,packageId:id,confirmationId:id};
const result={confirmationId:id,schemaVersion:"r1-source-pair-confirmation/1",dwgAssetVersionId:id,pdfAssetVersionId:"abcdef00-0000-4000-8000-000000000002",dwgRevision:1,pdfRevision:2,dwgSha256:"a".repeat(64),pdfSha256:"b".repeat(64),confirmedAt:"2026-09-16T00:00:00.000000Z",confirmationStatus:"architect_confirmed",conversionStatus:"unconfirmed",warning:"PDF предоставлен архитектором; DWG conversion не подтверждён"};
function fixture(patch: Record<string,unknown>={},error=false){
 const calls: unknown[]=[];
 const client: PostgresRpcClient={schema:(schema)=>({rpc:async(name,args)=>{calls.push({schema,name,args});return error?{data:null,error:{code:"P1103",message:"private"}}:{data:{contractVersion:"r1-source-pair-read/1",result:{...result,...patch}},error:null};}})};
 return {calls,adapter:new ProjectCeoAuthenticatedReadPostgresAdapter(client)};
}
describe("source-pair historical metadata read",()=>{
 it("sends only canonical exact selectors and returns strict immutable facts",async()=>{const f=fixture();expect(await f.adapter.getPdfDwgSourcePairConfirmation({projectId:id.toUpperCase(),packageId:id.toUpperCase(),confirmationId:id.toUpperCase()},"true")).toEqual({contractVersion:"r1-source-pair-read/1",result});expect(f.calls).toEqual([{schema:"projectceo_read_api",name:"get_pdf_dwg_source_pair_confirmation",args:{project_id:id,package_id:id,confirmation_id:id}}]);});
 it("module-off does not reach RPC",async()=>{const f=fixture();await expect(f.adapter.getPdfDwgSourcePairConfirmation(input,"false")).rejects.toThrow();expect(f.calls).toEqual([]);});
 it.each([{reason:"private"},{architectUserId:id},{privateLocator:"private"},{generationId:id},{conversionStatus:"confirmed"},{warning:""},{confirmationId:"abcdef00-0000-4000-8000-000000000009"},{dwgSha256:"bad"}])("rejects unsafe output %j",async(patch)=>{const f=fixture(patch);await expect(f.adapter.getPdfDwgSourcePairConfirmation(input,"true")).rejects.toThrow();});
 it("maps database denial",async()=>{const f=fixture({},true);await expect(f.adapter.getPdfDwgSourcePairConfirmation(input,"true")).rejects.toMatchObject({code:"forbidden"});});
 it("rejects invalid UUID before network",async()=>{const f=fixture();await expect(f.adapter.getPdfDwgSourcePairConfirmation({...input,confirmationId:"invalid"},"true")).rejects.toThrow();expect(f.calls).toEqual([]);});
});
