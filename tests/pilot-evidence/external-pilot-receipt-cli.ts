import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildExternalPilotReceipt, writeExternalPilotReceipt } from "./external-pilot-receipt";

async function main(): Promise<void> {
  const [
    receiptPath, challengeNonce, manifestDigest, executorPath, executorDigest, executorVerificationReceiptId,
    koraReceiptId, koraReceiptDigest, koraProducerPath, koraProducerDigest, harvestPath,
  ] = process.argv.slice(2);
  if (!receiptPath || !challengeNonce || !manifestDigest || !executorPath || !executorDigest
    || !executorVerificationReceiptId || !koraReceiptId || !koraReceiptDigest || !koraProducerPath
    || !koraProducerDigest || !harvestPath) {
    throw new Error("EXTERNAL_RECEIPT_CLI_ARGUMENTS_REQUIRED");
  }
  const harvest = JSON.parse(readFileSync(harvestPath, "utf8")) as never;
  const receipt = buildExternalPilotReceipt({
    challengeNonce,
    manifestDigest,
    executor: { path: executorPath, digest: executorDigest, verificationReceiptId: executorVerificationReceiptId },
    kora: { receiptId: koraReceiptId, receiptDigest: koraReceiptDigest, producerPath: koraProducerPath, producerDigest: koraProducerDigest },
    harvest,
  });
  writeExternalPilotReceipt(receipt, receiptPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "EXTERNAL_RECEIPT_CLI_FAILED"}\n`);
    process.exitCode = 1;
  });
}
