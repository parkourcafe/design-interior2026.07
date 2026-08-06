import { readFileSync } from "node:fs";
import { finalizeM2PilotEvidence } from "./finalize-m2-pilot-evidence";

const [receiptPath, outputDir, pendingPath, koraReceiptPath, label] = process.argv.slice(2);
if (!receiptPath || !outputDir || !pendingPath) throw new Error("RECEIPT_MISSING");
const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Record<string, unknown>;
const pending = JSON.parse(readFileSync(pendingPath, "utf8")) as Record<string, unknown>;
finalizeM2PilotEvidence(receipt, { outputDir, label, pending, pendingPath, koraReceiptPath });
