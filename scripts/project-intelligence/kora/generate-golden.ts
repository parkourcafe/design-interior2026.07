import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sourceManifest from "../../../tests/project-intelligence/fixtures/pro-up-ru/kora-food-hall-source-manifest.json";
import {
  buildKoraProjectBrainGolden,
  type KoraSourceManifestInput,
} from "../../../lib/project-intelligence/modules/package/kora-golden";

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, "../../../fixtures/project-intelligence/kora/kora-project-brain-golden.json");

async function main(): Promise<void> {
  const golden = buildKoraProjectBrainGolden(sourceManifest as KoraSourceManifestInput);
  await writeFile(outputPath, `${JSON.stringify(golden, null, 2)}\n`, "utf8");
  process.stdout.write(`KORA_GOLDEN_WRITTEN records=${golden.inventory.length} hash=${golden.fixtureHash}\n`);
}

void main();
