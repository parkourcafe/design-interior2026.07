import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const canonicalPath = path.join(
  repoRoot,
  "tests/project-intelligence/fixtures/pro-up-ru/kora-food-hall-source-manifest.json",
);
const publicPath = path.join(repoRoot, "public/kora-project-intelligence/manifest.json");

const sourceRoots = {
  food_hall:
    "/Users/msnigmatullaeva/Documents/kora ubud bali 03.06.2026/05 Kora Food Hall",
  food_hall_copy:
    "/Users/msnigmatullaeva/Documents/kora ubud bali 03.06.2026/05 Kora Food Hall 2",
  kora_10_construction:
    "/Users/msnigmatullaeva/Documents/kora ubud bali 03.06.2026/KORA/10_Construction",
  kora_construction:
    "/Users/msnigmatullaeva/Documents/kora ubud bali 03.06.2026/KORA_Construction",
};

const drawingDisciplines = new Set(["architecture", "mep", "visualization"]);

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

const manifest = JSON.parse(await readFile(canonicalPath, "utf8"));

for (const item of manifest.inventory) {
  const root = sourceRoots[item.collectionKey];
  if (
    !root ||
    item.status !== "current" ||
    !drawingDisciplines.has(item.discipline)
  ) {
    continue;
  }

  const filePath = path.join(root, item.relativePath);
  try {
    const fileStat = await stat(filePath);
    if (fileStat.blocks === 0) continue;
    item.availability = "local";
    item.sha256 = await sha256(filePath);
  } catch {
    // The manifest remains truthful when a source is missing or still cloud-only.
  }
}

const hashGroups = new Map();
for (const item of manifest.inventory) {
  if (item.availability === "cloud_placeholder") {
    item.sha256 = null;
    item.duplicateGroup = null;
    item.hashAliases = [];
    item.semanticConflict = false;
    continue;
  }
  if (!item.sha256) continue;
  const group = hashGroups.get(item.sha256) ?? [];
  group.push(item);
  hashGroups.set(item.sha256, group);
}

const conflictHashes = new Set(manifest.semanticNameConflictHashes);
for (const [hash, items] of hashGroups) {
  const isDuplicate = items.length > 1;
  const semanticConflict = conflictHashes.has(hash);
  for (const item of items) {
    item.duplicateGroup = isDuplicate ? `sha256:${hash}` : null;
    item.hashAliases = isDuplicate
      ? items.filter((candidate) => candidate.id !== item.id).map((candidate) => candidate.id)
      : [];
    item.semanticConflict = semanticConflict;
  }
}

manifest.exactHashIndex = Object.fromEntries(
  [...hashGroups].map(([hash, items]) => [
    hash,
    items.map((item) => `${item.collectionKey}:${item.relativePath}`),
  ]),
);

for (const [collectionKey, rootSummary] of Object.entries(manifest.sourceRoots)) {
  const items = manifest.inventory.filter((item) => item.collectionKey === collectionKey);
  rootSummary.materialized = items.filter((item) => item.availability === "local").length;
  rootSummary.cloudPlaceholder = items.filter(
    (item) => item.availability === "cloud_placeholder",
  ).length;
}

manifest.summary.materializedSources = manifest.inventory.filter(
  (item) => item.availability === "local",
).length;
manifest.summary.cloudPlaceholders = manifest.inventory.filter(
  (item) => item.availability === "cloud_placeholder",
).length;
manifest.summary.uniqueMaterializedBlobs = hashGroups.size;
manifest.summary.duplicateHashGroups = [...hashGroups.values()].filter(
  (items) => items.length > 1,
).length;
manifest.summary.semanticNameConflictGroups = manifest.semanticNameConflictHashes.length;

const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(canonicalPath, serialized);
await writeFile(publicPath, serialized);

console.log(
  JSON.stringify(
    {
      materializedSources: manifest.summary.materializedSources,
      cloudPlaceholders: manifest.summary.cloudPlaceholders,
      uniqueMaterializedBlobs: manifest.summary.uniqueMaterializedBlobs,
      duplicateHashGroups: manifest.summary.duplicateHashGroups,
      semanticNameConflictGroups: manifest.summary.semanticNameConflictGroups,
    },
    null,
    2,
  ),
);
