import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { finalizeWp32ExternalRuntimeFile } from "./finalize-wp32-external-runtime";

const [outputPath]=process.argv.slice(2);
if(!outputPath||existsSync(outputPath)) throw new Error("WP32_FINALIZER_ARGUMENTS_INVALID");
const executorPath="tests/pilot-evidence/executors/wp32-external-runtime-runner.mjs";
const scannerPath="tests/pilot-evidence/executors/wp32-bound-scanner.ts";
const manifestPath="tests/fixtures/cycle7/the-abian-source-manifest.json";
const lockfilePath="package-lock.json";
const sha=(path:string)=>createHash("sha256").update(readFileSync(path)).digest("hex");
const headSha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const executorDigest=sha(executorPath),scannerDigest=sha(scannerPath),manifestDigest=sha(manifestPath),lockfileDigest=sha(lockfilePath);
const allowlist=JSON.parse(readFileSync("tests/pilot-evidence/executors/allowlist.json","utf8")) as {
  readonly executors?:readonly {readonly path?:string;readonly digest?:string}[]};
for(const [path,digest] of [[executorPath,executorDigest],[scannerPath,scannerDigest]] as const){
  if(!allowlist.executors?.some(row=>row.path===path&&row.digest===`sha256:${digest}`)) throw new Error("WP32_FINALIZER_EXECUTOR_NOT_ALLOWLISTED");
}
const trackedPaths=["lib/project-intelligence/delivery/projectceo/command-service.ts",
  "tests/ap1/environment/register-bound-child-source.ts",scannerPath,executorPath,
  "tests/pilot-evidence/finalize-wp32-external-runtime.ts","tests/pilot-evidence/finalize-wp32-external-runtime-cli.ts",
  manifestPath,"tests/pilot-evidence/executors/allowlist.json",lockfilePath];
const trackedBindings=Object.fromEntries(trackedPaths.map(path=>{
  const committed=execFileSync("git",["show",`${headSha}:${path}`]);
  const working=readFileSync(path);
  if(!committed.equals(working)) throw new Error("WP32_FINALIZER_TRACKED_RUNTIME_DIRTY");
  return [path,createHash("sha256").update(committed).digest("hex")];
}));
const childEnvironment={...process.env};delete childEnvironment.WP32_FAST_DIAGNOSTIC;
const run=spawnSync("./node_modules/.bin/tsx",[executorPath],{encoding:"utf8",env:childEnvironment,timeout:3_600_000,maxBuffer:4_194_304});
if(run.status!==0) throw new Error("WP32_FINALIZER_EXECUTOR_FAILED");
const evidencePath=run.stdout.match(/^ARCHITECT_INTAKE_EVIDENCE=(\/private\/tmp\/remhaos-architect-intake-[^\n]+\/evidence\.json)$/m)?.[1];
if(!evidencePath||!existsSync(evidencePath)||lstatSync(evidencePath).isSymbolicLink()||realpathSync(evidencePath)!==evidencePath)
  throw new Error("WP32_FINALIZER_EVIDENCE_PATH_INVALID");
const receipt=finalizeWp32ExternalRuntimeFile(evidencePath,outputPath,{headSha,manifestDigest,executorDigest,scannerDigest,lockfileDigest,trackedBindings});
process.stdout.write(`WP32_RUNTIME_FINALIZED verdict=${receipt.verdict} head=${receipt.headSha} output=${outputPath}\n`);
