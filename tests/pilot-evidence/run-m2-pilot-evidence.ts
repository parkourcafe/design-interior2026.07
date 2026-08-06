import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { readPilotManifest, validateExternalPilot, validateKoraPilot } from "./m2-pilot-evidence-contract";

type UnknownObject = Record<string, unknown>;
const digest = (path: string) => `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
const DEFAULT_KORA_PRODUCER = "tests/pilot-evidence/run-m2-pilot-evidence.zsh";

export interface PrepareM2PilotEvidenceInput {
  readonly outputPath: string;
  readonly challengeNonce: string;
  readonly manifestDigest: string;
  readonly executor: UnknownObject;
  readonly koraReceipt: UnknownObject;
  readonly koraReceiptPath?: string;
  readonly koraReceiptDigest?: string;
  readonly koraProducerPath?: string;
  readonly koraProducerDigest?: string;
  readonly koraManifestDigest?: string;
}

export function prepareM2PilotEvidence(input: PrepareM2PilotEvidenceInput): UnknownObject {
  const producerPath = input.koraProducerPath ?? DEFAULT_KORA_PRODUCER;
  const producerDigest = input.koraProducerDigest ?? digest(producerPath);
  const receiptDigest = input.koraReceiptPath ? digest(input.koraReceiptPath) : input.koraReceiptDigest ?? input.koraReceipt.digest;
  if (input.koraReceiptDigest && receiptDigest !== input.koraReceiptDigest) throw new Error("KORA_RECEIPT_DIGEST_MISMATCH");
  const producerClaim = input.koraReceipt.producer as UnknownObject | undefined;
  if (producerClaim && (producerClaim.path !== producerPath || producerClaim.digest !== producerDigest
    || producerClaim.challengeNonce !== input.challengeNonce || producerClaim.repoOwned !== true)) throw new Error("KORA_PRODUCER_CLAIM_MISMATCH");
  const pending: UnknownObject = {
    contractVersion: "archidom.m2-pilot-pending/0.2",
    status: "MANIFEST_VALIDATED_PENDING_RUN",
    koraManifestDigest: input.koraManifestDigest ?? null,
    externalManifestDigest: input.manifestDigest,
    challengeNonce: input.challengeNonce,
    pendingBinding: {
      executorPath: input.executor.path,
      executorDigest: input.executor.digest,
      executorVerificationReceiptId: input.executor.verificationReceiptId,
      koraReceiptDigest: receiptDigest,
      koraReceiptId: input.koraReceipt.receiptId,
      koraReceiptPath: input.koraReceiptPath ?? null,
      koraProducerPath: producerPath,
      koraProducerDigest: producerDigest,
      koraChallengeNonce: input.challengeNonce,
    },
    productionChanged: false,
  };
  writeFileSync(input.outputPath, JSON.stringify(pending, null, 2), { flag: "wx", mode: 0o600 });
  return pending;
}

async function main(): Promise<void> {
  const [mode, koraPath, externalPath, pendingPath, challengeNonce, executorPath, executorDigest, executorVerificationReceiptId, koraReceiptPath, koraReceiptDigest, koraProducerPath, koraProducerDigest] = process.argv.slice(2);
  if (mode !== "prepare" || !koraPath || !externalPath || !pendingPath || !challengeNonce || !executorPath || !executorDigest || !executorVerificationReceiptId || !koraReceiptPath || !koraReceiptDigest || !koraProducerPath || !koraProducerDigest) throw new Error("CYCLE7_RUNNER_ARGUMENTS_REQUIRED");
  const kora = readPilotManifest(koraPath); const external = readPilotManifest(externalPath);
  validateKoraPilot(kora); validateExternalPilot(external, kora);
  const koraReceipt = JSON.parse(readFileSync(koraReceiptPath, "utf8")) as UnknownObject;
  prepareM2PilotEvidence({ outputPath: pendingPath, challengeNonce, manifestDigest: digest(externalPath),
    koraManifestDigest: digest(koraPath), executor: { path: executorPath, digest: executorDigest, verificationReceiptId: executorVerificationReceiptId },
    koraReceipt, koraReceiptPath, koraReceiptDigest, koraProducerPath, koraProducerDigest });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
