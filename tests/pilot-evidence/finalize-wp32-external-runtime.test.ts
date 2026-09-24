import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import { finalizeWp32ExternalRuntime } from "./finalize-wp32-external-runtime";

const d=(c:string)=>c.repeat(64),u=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const hashes=[d("1"),d("2"),d("3")] as const;
function fixture(){
  const aliases=["architect-source-1.pdf","architect-source-2.xlsx","architect-source-3.png"] as const;
  const fixed=["99a44ddb01fed41d5b6b9d7f2bce36cf6245394fdd9dedba33b3c15ae4be5eba",
    "f6096a9857d163f0348ef057531790a20c847542a954f67e748b53c033afc654",
    "9258296141ea1dfc5f9a2b34f25224a6a4cd8d728e6361e0765cb36efc3568d3"];
  const raw={schema:"remhaos.wp32-external-runtime/1",status:"WP32_EXTERNAL_AUTHENTICATED_RUNTIME_PASS",
    sourceCommit:"a".repeat(40),harnessSha256:hashes[0],scannerHarnessSha256:hashes[1],lockfileSha256:hashes[2],
    trackedBindings:{"runtime.ts":hashes[0]},
    environment:"local_disposable",productionChanged:false,scannerRun:true,fullExternalE2E:true,fastDiagnostic:false,
    disposed:true,emptyDisposableDocker:true,checks:Array.from({length:66},(_,i)=>({name:`check-${i}`,pass:true})),
    scope:{organizationId:u(1),projectId:u(2),packageId:u(3),intakeScope:"work_package"},
    sources:aliases.map((alias,i)=>({alias,sourceSha256:fixed[i],byteLength:i+1,firstHttpStatus:201,replayHttpStatus:201,
      scanCompletion:{outcome:"clean"},childSource:{packageId:u(3),checksum:fixed[i],sourceId:`source-${i}`,
        sourceRevisionId:`source-r${i}`,fragmentId:`fragment-${i}`,evidenceLinkId:`evidence-${i}`}})),
    sourceSnapshot:{result:{version:{id:"version-1"}}},impactCoverage:{coverageStatus:"complete",returnedImpactCount:1,knownImpactCountLowerBound:1},
    chain:{baselineId:"baseline-1",releaseVersion:"release-1",distributionId:u(4),changeRequestId:u(5),impactRunId:u(6),
      milestoneId:u(7),photoEvidenceId:u(8),photoReviewId:u(9),acceptanceId:u(10),sessions:{owner:u(11),architect:u(12),builder:u(13),client:u(14)}},
    remaining:"FINALIZER_CYCLE7_AND_FINAL_SHA_REVIEW_PENDING"};
  const expected={headSha:"a".repeat(40),manifestDigest:hashes[0],executorDigest:hashes[0],scannerDigest:hashes[1],lockfileDigest:hashes[2],
    trackedBindings:{"runtime.ts":hashes[0]}};
  return {raw,expected};
}
describe("WP32 external runtime finalizer",()=>{
  it("accepts only the exact full disposable chain",()=>{const f=fixture();expect(finalizeWp32ExternalRuntime(f.raw,f.expected)).toMatchObject({
    status:"completed",verdict:"EXTERNAL_REAL_PACKAGE_PASS",gates:{nativeM3FullDelivery:true,completeImpact:true,disposed:true}});});
  it.each(["sourceCommit","harnessSha256","scannerHarnessSha256","lockfileSha256"])("rejects changed %s",key=>{
    const f=fixture();(f.raw as Record<string,unknown>)[key]=key==="sourceCommit"?"b".repeat(40):d("f");
    expect(()=>finalizeWp32ExternalRuntime(f.raw,f.expected)).toThrow();
  });
  it("rejects incomplete impact and failed checks",()=>{const f=fixture();f.raw.impactCoverage.knownImpactCountLowerBound=2;
    expect(()=>finalizeWp32ExternalRuntime(f.raw,f.expected)).toThrow("WP32_RUNTIME_IMPACT_INCOMPLETE");
    const g=fixture();g.raw.checks[0]!.pass=false;expect(()=>finalizeWp32ExternalRuntime(g.raw,g.expected)).toThrow();});
  it("rejects private path leakage",()=>{const f=fixture();(f.raw as Record<string,unknown>).debug="/Users/private/source.pdf";
    expect(()=>finalizeWp32ExternalRuntime(f.raw,f.expected)).toThrow("WP32_RUNTIME_PRIVATE_DATA_LEAK");});
  it("launches the allowlisted executor instead of accepting a caller raw path",()=>{
    const cli=readFileSync("tests/pilot-evidence/finalize-wp32-external-runtime-cli.ts","utf8");
    expect(cli).toContain('spawnSync("./node_modules/.bin/tsx",[executorPath]');
    expect(cli).not.toMatch(/const \[rawPath/);
    expect(cli).toContain("WP32_FINALIZER_TRACKED_RUNTIME_DIRTY");
  });
});
