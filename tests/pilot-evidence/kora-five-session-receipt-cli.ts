import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildKoraFiveSessionReceipt, writeKoraFiveSessionReceipt } from "./kora-five-session-receipt";

async function main(): Promise<void> {
  const [receiptPath, challengeNonce, producerPath, producerDigest, harvestPath] = process.argv.slice(2);
  if (!receiptPath || !challengeNonce || !producerPath || !producerDigest || !harvestPath) {
    throw new Error("KORA_RECEIPT_CLI_ARGUMENTS_REQUIRED");
  }
  const harvest = JSON.parse(readFileSync(harvestPath, "utf8")) as { runMarker: string; sessions: Record<string, unknown> };
  const receipt = buildKoraFiveSessionReceipt({
    challengeNonce,
    receiptId: randomUUID(),
    producer: { path: producerPath, digest: producerDigest },
    harvest,
  });
  writeKoraFiveSessionReceipt(receipt, receiptPath);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "KORA_RECEIPT_CLI_FAILED"}\n`);
  process.exitCode = 1;
});
