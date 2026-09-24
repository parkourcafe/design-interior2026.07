import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid();
const source = z.object({
  alias: z.enum(["architect-source-1.pdf", "architect-source-2.xlsx", "architect-source-3.png"]),
  sourceSha256: digest,
  byteLength: z.number().int().positive(),
  firstHttpStatus: z.literal(201),
  replayHttpStatus: z.literal(201),
  scanCompletion: z.object({ outcome: z.literal("clean") }).passthrough(),
  childSource: z.object({ packageId: uuid, checksum: digest, sourceId: z.string().min(1),
    sourceRevisionId: z.string().min(1), fragmentId: z.string().min(1), evidenceLinkId: z.string().min(1) }).passthrough(),
}).passthrough();
const rawSchema = z.object({
  schema: z.literal("remhaos.wp32-external-runtime/1"),
  status: z.literal("WP32_EXTERNAL_AUTHENTICATED_RUNTIME_PASS"),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  harnessSha256: digest,
  scannerHarnessSha256: digest,
  lockfileSha256: digest,
  environment: z.literal("local_disposable"),
  productionChanged: z.literal(false), scannerRun: z.literal(true), fullExternalE2E: z.literal(true),
  fastDiagnostic: z.literal(false), disposed: z.literal(true), emptyDisposableDocker: z.literal(true),
  checks: z.array(z.object({name:z.string().min(1),pass:z.literal(true)}).passthrough()).min(60),
  sources: z.array(source).length(3),
  scope: z.object({organizationId:uuid,projectId:uuid,packageId:uuid,intakeScope:z.literal("work_package")}).strict(),
  sourceSnapshot: z.object({result:z.object({version:z.object({id:z.string().min(1)}).passthrough()}).passthrough()}).passthrough(),
  impactCoverage: z.object({coverageStatus:z.literal("complete"),returnedImpactCount:z.number().int().positive(),
    knownImpactCountLowerBound:z.number().int().positive()}).strict(),
  chain: z.object({baselineId:z.string().min(1),releaseVersion:z.string().min(1),distributionId:uuid,
    changeRequestId:uuid,impactRunId:uuid,milestoneId:uuid,photoEvidenceId:uuid,photoReviewId:uuid,
    acceptanceId:uuid,sessions:z.object({owner:uuid,architect:uuid,builder:uuid,client:uuid}).strict()}).passthrough(),
  remaining: z.literal("FINALIZER_CYCLE7_AND_FINAL_SHA_REVIEW_PENDING"),
}).passthrough();

const sourceBindings = new Map([
  ["architect-source-1.pdf", "99a44ddb01fed41d5b6b9d7f2bce36cf6245394fdd9dedba33b3c15ae4be5eba"],
  ["architect-source-2.xlsx", "f6096a9857d163f0348ef057531790a20c847542a954f67e748b53c033afc654"],
  ["architect-source-3.png", "9258296141ea1dfc5f9a2b34f25224a6a4cd8d728e6361e0765cb36efc3568d3"],
]);
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const privatePath = /(?:\/Users\/|file:\/\/|\/home\/|[A-Za-z]:\\|\.env\b|originalFilename|storagePath|accessToken|refreshToken)/i;

export interface Wp32RuntimeExpected {
  readonly headSha: string;
  readonly manifestDigest: string;
  readonly executorDigest: string;
  readonly scannerDigest: string;
  readonly lockfileDigest: string;
}

export function finalizeWp32ExternalRuntime(raw: unknown, expected: Wp32RuntimeExpected) {
  const parsed=rawSchema.parse(raw);
  if(parsed.sourceCommit!==expected.headSha) throw new Error("WP32_RUNTIME_HEAD_MISMATCH");
  if(parsed.harnessSha256!==expected.executorDigest||parsed.scannerHarnessSha256!==expected.scannerDigest
    ||parsed.lockfileSha256!==expected.lockfileDigest) throw new Error("WP32_RUNTIME_EXECUTOR_DIGEST_MISMATCH");
  if(new Set(parsed.sources.map(row=>row.alias)).size!==3
    ||parsed.sources.some(row=>sourceBindings.get(row.alias)!==row.sourceSha256||row.childSource.checksum!==row.sourceSha256
      ||row.childSource.packageId!==parsed.scope.packageId)) throw new Error("WP32_RUNTIME_SOURCE_BINDING_INVALID");
  if(parsed.impactCoverage.knownImpactCountLowerBound!==parsed.impactCoverage.returnedImpactCount)
    throw new Error("WP32_RUNTIME_IMPACT_INCOMPLETE");
  if(new Set(Object.values(parsed.chain.sessions)).size!==4) throw new Error("WP32_RUNTIME_SESSIONS_NOT_DISTINCT");
  const serialized=JSON.stringify(parsed);
  if(privatePath.test(serialized)) throw new Error("WP32_RUNTIME_PRIVATE_DATA_LEAK");
  return {
    contractVersion:"remhaos.wp32-runtime-receipt/1" as const,status:"completed" as const,
    verdict:"EXTERNAL_REAL_PACKAGE_PASS" as const,headSha:expected.headSha,
    manifestDigest:`sha256:${expected.manifestDigest}`,deliveryEvidenceDigest:`sha256:${sha256(serialized)}`,
    executor:{path:"tests/pilot-evidence/executors/wp32-external-runtime-runner.mjs",digest:`sha256:${expected.executorDigest}`},
    scanner:{path:"tests/pilot-evidence/executors/wp32-bound-scanner.ts",digest:`sha256:${expected.scannerDigest}`},
    gates:{nativeM3FullDelivery:true,sourceContentVerified:true,authenticatedRoles:true,exactReplay:true,
      completeImpact:true,photoAcceptance:true,disposed:true,productionChanged:false},
    sources:parsed.sources.map(row=>({alias:row.alias,sha256:`sha256:${row.sourceSha256}`,scanOutcome:"clean" as const})),
  };
}

export function finalizeWp32ExternalRuntimeFile(rawPath:string,outputPath:string,expected:Wp32RuntimeExpected){
  const raw=JSON.parse(readFileSync(rawPath,"utf8"));
  const receipt=finalizeWp32ExternalRuntime(raw,expected);
  const temporary=`${outputPath}.tmp`;
  try{writeFileSync(temporary,`${JSON.stringify(receipt,null,2)}\n`,{encoding:"utf8",mode:0o600,flag:"wx"});renameSync(temporary,outputPath);}
  catch(error){rmSync(temporary,{force:true});throw error;}
  return receipt;
}
