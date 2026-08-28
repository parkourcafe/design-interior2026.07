import { runPilotExecutor } from "./finalize-m2-pilot-evidence";

async function main(): Promise<void> {
  const [executorPath, challengeNonce, outputDir, manifestPath, executorVerificationReceiptId, koraReceiptDigest, koraReceiptId, koraProducerPath, koraProducerDigest] = process.argv.slice(2);
  if (!executorPath || !challengeNonce || !outputDir) throw new Error("CYCLE7_EXECUTOR_ARGUMENTS_REQUIRED");
  await runPilotExecutor({ executorPath, challengeNonce, outputDir, manifestPath, executorVerificationReceiptId, koraReceiptDigest, koraReceiptId, koraProducerPath, koraProducerDigest });
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "CYCLE7_EXECUTOR_FAILED"}\n`);
  process.exitCode = 1;
});
