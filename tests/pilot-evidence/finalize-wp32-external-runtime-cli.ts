import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { finalizeWp32ExternalRuntimeFile } from "./finalize-wp32-external-runtime";

const [rawPath,outputPath]=process.argv.slice(2);
if(!rawPath||!outputPath||!existsSync(rawPath)||existsSync(outputPath)) throw new Error("WP32_FINALIZER_ARGUMENTS_INVALID");
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
const receipt=finalizeWp32ExternalRuntimeFile(rawPath,outputPath,{headSha,manifestDigest,executorDigest,scannerDigest,lockfileDigest});
process.stdout.write(`WP32_RUNTIME_FINALIZED verdict=${receipt.verdict} head=${receipt.headSha} output=${outputPath}\n`);
