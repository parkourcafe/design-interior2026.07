#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

const reportPath = process.argv[2] ?? process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
if (!reportPath || !existsSync(reportPath)) {
  console.error("AP5_NO_SKIPS_FAILED report_missing");
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch {
  console.error("AP5_NO_SKIPS_FAILED report_invalid_json");
  process.exit(1);
}

const skipped = Number(report?.stats?.skipped ?? 0);
if (!Number.isFinite(skipped) || skipped !== 0) {
  console.error(`AP5_NO_SKIPS_FAILED skipped=${Number.isFinite(skipped) ? skipped : "unknown"}`);
  process.exit(1);
}

console.log(`AP5_NO_SKIPS_OK skipped=0 passed=${report?.stats?.expected ?? "unknown"}`);
