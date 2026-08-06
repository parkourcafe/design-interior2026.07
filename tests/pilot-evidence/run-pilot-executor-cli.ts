import { runPilotExecutor } from "./finalize-m2-pilot-evidence";

const [executorPath, challengeNonce, outputDir, manifestPath, executorVerificationReceiptId, koraReceiptDigest, koraReceiptId, koraProducerPath, koraProducerDigest] = process.argv.slice(2);
if (!executorPath || !challengeNonce || !outputDir) throw new Error("CYCLE7_EXECUTOR_ARGUMENTS_REQUIRED");
await runPilotExecutor({ executorPath, challengeNonce, outputDir, manifestPath, executorVerificationReceiptId, koraReceiptDigest, koraReceiptId, koraProducerPath, koraProducerDigest });
