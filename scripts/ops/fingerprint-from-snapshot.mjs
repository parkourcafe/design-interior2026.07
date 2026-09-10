#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SNAPSHOT_CONTRACT = "remhaos-production-catalog/2.0";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const defaultBaseline = resolve(
  repositoryRoot,
  "docs/product-intelligence/wave-3/production-adoption/PRODUCTION_READ_ONLY_FINGERPRINT_2026-07-19.md",
);

const categorySources = [
  ["migration_ledger", ["migration_ledger"]],
  ["schemas", ["schemas"]],
  ["relations", ["relations"]],
  ["columns", ["columns"]],
  ["constraints", ["constraints"]],
  ["indexes", ["indexes"]],
  ["policies", ["policies"]],
  ["routines", ["functions"]],
  ["views", ["views"]],
  ["triggers", ["triggers"]],
  ["enums", ["enums"]],
  ["types", ["types"]],
  [
    "grants",
    [
      "table_grants",
      "column_grants",
      "routine_grants",
      "usage_grants",
      "default_privileges",
      "schema_role_privileges",
    ],
  ],
  ["roles", ["roles"]],
  ["role_memberships", ["role_memberships"]],
  ["extensions", ["extensions"]],
];

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function digest(algorithm, value) {
  return createHash(algorithm).update(value, "utf8").digest("hex");
}

function parseJsonValue(value) {
  let candidate = value;
  for (let depth = 0; depth < 3 && typeof candidate === "string"; depth += 1) {
    candidate = JSON.parse(candidate);
  }
  return candidate;
}

export function unwrapSnapshotPayload(input) {
  let candidate = parseJsonValue(input);
  if (Array.isArray(candidate)) {
    if (candidate.length !== 1) {
      throw new Error("snapshot export must contain exactly one result row");
    }
    [candidate] = candidate;
  }
  if (
    candidate !== null
    && typeof candidate === "object"
    && Object.hasOwn(candidate, "production_schema_snapshot")
  ) {
    candidate = parseJsonValue(candidate.production_schema_snapshot);
  }
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("snapshot payload must be a JSON object");
  }
  if (candidate.snapshot_contract !== SNAPSHOT_CONTRACT) {
    throw new Error(
      `unsupported snapshot_contract: ${String(candidate.snapshot_contract ?? "missing")}`,
    );
  }
  return candidate;
}

function categoryLines(snapshot, sources) {
  const lines = [];
  for (const source of sources) {
    const items = snapshot[source];
    if (!Array.isArray(items)) {
      throw new Error(`snapshot category ${source} must be an array`);
    }
    for (const item of items) {
      lines.push(canonicalJson(sources.length === 1 ? item : { source, item }));
    }
  }
  return lines.sort();
}

export function buildFingerprint(snapshotInput) {
  const snapshot = unwrapSnapshotPayload(snapshotInput);
  const categories = categorySources.map(([name, sources]) => {
    const lines = categoryLines(snapshot, sources);
    return {
      name,
      count: lines.length,
      md5: digest("md5", lines.join("\n")),
    };
  });
  const combinedInput = categories
    .map(({ name, count, md5 }) => `${name}\t${count}\t${md5}`)
    .join("\n");
  return {
    snapshotContract: snapshot.snapshot_contract,
    capturedAt: String(snapshot.captured_at ?? "UNKNOWN"),
    database: String(snapshot.database ?? "UNKNOWN"),
    serverVersion: String(snapshot.server_version ?? "UNKNOWN"),
    categories,
    combinedSummarySha256: digest("sha256", combinedInput),
  };
}

export function renderFingerprintMarkdown(fingerprint) {
  const rows = fingerprint.categories
    .map(({ name, count, md5 }) => `| ${name} | ${count} | \`${md5}\` |`)
    .join("\n");
  return `# RemHaOS — Production read-only fingerprint\n\n`
    + `Snapshot contract: \`${fingerprint.snapshotContract}\`  \n`
    + `Captured at: \`${fingerprint.capturedAt}\`  \n`
    + `Database: \`${fingerprint.database}\`  \n`
    + `PostgreSQL: \`${fingerprint.serverVersion}\`\n\n`
    + "The snapshot was reduced locally to sorted canonical catalog lines. "
    + "MD5 is a drift checksum only; the ordered category summaries are covered by SHA-256.\n\n"
    + "| Category | Count | MD5 |\n|---|---:|---|\n"
    + `${rows}\n\n`
    + "```text\ncombined_summary_sha256=\n"
    + `${fingerprint.combinedSummarySha256}\n\`\`\`\n`;
}

export function parseBaselineFingerprint(markdown) {
  const categories = new Map();
  const rowPattern = /^\|\s*([a-z][a-z0-9_]*)\s*\|\s*(\d+)\s*\|\s*`([a-f0-9]{32})`\s*\|$/gim;
  for (const match of markdown.matchAll(rowPattern)) {
    categories.set(match[1], { count: Number(match[2]), md5: match[3] });
  }
  if (categories.size === 0) {
    throw new Error("baseline fingerprint contains no category rows");
  }
  return categories;
}

export function buildDriftRows(fingerprint, baselineCategories) {
  const currentCategories = new Map(
    fingerprint.categories.map(({ name, count, md5 }) => [name, { count, md5 }]),
  );
  const names = [...new Set([...baselineCategories.keys(), ...currentCategories.keys()])].sort();
  const rows = [];
  for (const name of names) {
    const baseline = baselineCategories.get(name);
    const current = currentCategories.get(name);
    if (baseline && current && baseline.count === current.count && baseline.md5 === current.md5) {
      continue;
    }
    const id = `SNAPSHOT-${String(rows.length + 1).padStart(3, "0")}`;
    if (!baseline) {
      rows.push({
        id,
        conflict: `${name}: category absent from 2026-07-19 baseline`,
        status: "BASELINE_REQUIRED",
        evidence: `current count=${current.count} md5=${current.md5}`,
        resolution: "Review category and approve a v2 baseline before adoption",
      });
      continue;
    }
    if (!current) {
      rows.push({
        id,
        conflict: `${name}: category absent from current snapshot`,
        status: "BLOCKER",
        evidence: `baseline count=${baseline.count} md5=${baseline.md5}`,
        resolution: "Correct snapshot scope or document object removal before adoption",
      });
      continue;
    }
    rows.push({
      id,
      conflict: `${name}: catalog fingerprint changed since 2026-07-19`,
      status: "REVIEW_REQUIRED",
      evidence: `baseline count=${baseline.count} md5=${baseline.md5}; current count=${current.count} md5=${current.md5}`,
      resolution: "Classify additions, removals and changed definitions before adoption",
    });
  }
  return rows;
}

function csvCell(value) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function renderConflictCsv(rows) {
  const header = "id,conflict,status,evidence,resolution";
  return `${header}\n${rows.map((row) => [
    row.id,
    row.conflict,
    row.status,
    row.evidence,
    row.resolution,
  ].map(csvCell).join(",")).join("\n")}${rows.length > 0 ? "\n" : ""}`;
}

function parseArguments(argv) {
  const allowedKeys = new Set([
    "snapshot",
    "fingerprint-out",
    "baseline",
    "conflicts-out",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("usage: --snapshot FILE [--fingerprint-out FILE] [--baseline FILE] [--conflicts-out FILE]");
    }
    const name = key.slice(2);
    if (!allowedKeys.has(name)) {
      throw new Error(`unknown option: ${key}`);
    }
    if (values.has(name)) {
      throw new Error(`duplicate option: ${key}`);
    }
    values.set(name, value);
  }
  if (!values.has("snapshot")) {
    throw new Error("--snapshot FILE is required");
  }
  return values;
}

async function main() {
  const argumentsMap = parseArguments(process.argv.slice(2));
  const snapshotText = await readFile(resolve(argumentsMap.get("snapshot")), "utf8");
  const fingerprint = buildFingerprint(snapshotText);
  const markdown = renderFingerprintMarkdown(fingerprint);
  const fingerprintOutput = argumentsMap.get("fingerprint-out");
  if (fingerprintOutput) {
    await writeFile(resolve(fingerprintOutput), markdown, "utf8");
  } else {
    process.stdout.write(markdown);
  }

  const conflictsOutput = argumentsMap.get("conflicts-out");
  if (conflictsOutput) {
    const baselinePath = resolve(argumentsMap.get("baseline") ?? defaultBaseline);
    const baseline = parseBaselineFingerprint(await readFile(baselinePath, "utf8"));
    const rows = buildDriftRows(fingerprint, baseline);
    await writeFile(resolve(conflictsOutput), renderConflictCsv(rows), "utf8");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`fingerprint-from-snapshot: ${error.message}\n`);
    process.exitCode = 1;
  });
}
