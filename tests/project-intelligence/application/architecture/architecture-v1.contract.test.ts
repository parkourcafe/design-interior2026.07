import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = process.cwd();
const APPLICATION_ROOT = resolve(REPOSITORY_ROOT, "lib/project-intelligence/application");
const MANIFEST_PATH = resolve(
  REPOSITORY_ROOT,
  "docs/product-intelligence/agent-runs/wave-2/agent-1/frozen-input-manifest.json",
);
const LAUNCH_AGGREGATE_SHA256 = "c09a4d58120865927dc03b981e0de24345bd43306ff6d5e6858658e57ee87350";

const REQUIRED_FROZEN_PATHS = [
  "docs/product-intelligence/architecture-v1.md",
  "docs/product-intelligence/domain/contract-v0.1.json",
  "docs/product-intelligence/domain/contract-v0.1.md",
  "docs/product-intelligence/multi-agent/wave-2/README.md",
  "docs/product-intelligence/multi-agent/wave-2/agent-1-architecture-guardian.md",
  "docs/product-intelligence/multi-agent/wave-2/agent-2-workflow-application.md",
  "docs/product-intelligence/multi-agent/wave-2/agent-3-change-handoff.md",
  "docs/product-intelligence/multi-agent/wave-2/integration-and-acceptance.md",
  "docs/product-intelligence/multi-agent/wave-2/launch-prompts.md",
  "docs/product-intelligence/vertical-slice-l1-spec.md",
  "docs/product-intelligence/vertical-slice/README.md",
  "docs/product-intelligence/vertical-slice/api-contract.md",
  "docs/product-intelligence/vertical-slice/contract-gaps.md",
  "docs/product-intelligence/vertical-slice/events.md",
  "docs/product-intelligence/vertical-slice/traceability.md",
  "docs/product-intelligence/vertical-slice/ui-state-machine.md",
  "docs/product-intelligence/vertical-slice/use-case.md",
  "fixtures/project-intelligence/kitchen-worktop/manifest.json",
  "fixtures/project-intelligence/kitchen-worktop/validate.mjs",
  "lib/project-intelligence/index.ts",
  "tests/project-intelligence/vertical-slice-contract.integration.test.ts",
] as const;

const APPLICATION_TRACKS = [
  {
    name: "workflow",
    root: resolve(APPLICATION_ROOT, "workflow"),
  },
  {
    name: "change-handoff",
    root: resolve(APPLICATION_ROOT, "change-handoff"),
  },
] as const;

interface FrozenManifestEntry {
  path: string;
  sha256: string;
}

interface FrozenInputManifest {
  schemaVersion: string;
  hashAlgorithm: string;
  canonicalEntryFormat: string;
  fileCount: number;
  aggregateSha256: string;
  files: FrozenManifestEntry[];
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function readManifest(): FrozenInputManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as FrozenInputManifest;
}

function canonicalManifestEntries(entries: readonly FrozenManifestEntry[]): string {
  return entries.map(({ path, sha256: hash }) => `${hash}  ${path}\n`).join("");
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];

  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = resolve(root, entry.name);
      return entry.isDirectory() ? walkFiles(absolutePath) : [absolutePath];
    })
    .sort();
}

function repositoryPath(absolutePath: string): string {
  return relative(REPOSITORY_ROOT, absolutePath).split(sep).join("/");
}

function isProductionTypeScript(absolutePath: string): boolean {
  const path = repositoryPath(absolutePath);
  return path.endsWith(".ts")
    && !path.endsWith(".d.ts")
    && !/\.(?:test|spec)\.ts$/.test(path)
    && !/(?:^|\/)(?:__tests__|tests?|test-support|support)(?:\/|$)/.test(path);
}

function moduleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const staticImportOrExport = /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  const commonJsRequire = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const pattern of [staticImportOrExport, dynamicImport, commonJsRequire]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.push(match[1]);
    }
  }

  return specifiers;
}

function isWithin(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === ""
    || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== "..");
}

function resolvedImport(file: string, specifier: string): string | undefined {
  if (specifier.startsWith(".")) return resolve(dirname(file), specifier);
  if (specifier.startsWith("@/")) return resolve(REPOSITORY_ROOT, specifier.slice(2));
  return undefined;
}

function forbiddenImportReason(file: string, specifier: string): string | undefined {
  const normalized = specifier.replaceAll("\\", "/");
  const target = resolvedImport(file, normalized);

  if (normalized === "next" || normalized.startsWith("next/")) return "Next.js dependency";
  if (normalized.toLowerCase().includes("supabase")) return "Supabase dependency";
  if (["fs", "fs/promises", "node:fs", "node:fs/promises"].includes(normalized)) {
    return "filesystem storage dependency";
  }
  if (/(?:^|[/.-])storage(?:[/.-]|$)/i.test(normalized)) return "storage dependency";

  if (
    normalized === "@/app"
    || normalized.startsWith("@/app/")
    || normalized === "app"
    || normalized.startsWith("app/")
    || (target !== undefined && isWithin(resolve(REPOSITORY_ROOT, "app"), target))
  ) {
    return "app/delivery dependency";
  }

  if (normalized.startsWith("node:")) return undefined;
  if (target !== undefined) {
    const domainPublicIndex = resolve(REPOSITORY_ROOT, "lib/project-intelligence/index");
    const domainPublicIndexWithExtension = `${domainPublicIndex}.ts`;
    const domainPublicRoot = resolve(REPOSITORY_ROOT, "lib/project-intelligence");
    const sourceTrack = APPLICATION_TRACKS.find((track) => isWithin(track.root, file));
    const targetTrack = APPLICATION_TRACKS.find((track) => isWithin(track.root, target));
    if (sourceTrack && targetTrack && sourceTrack.name !== targetTrack.name) {
      return "cross-track private application dependency";
    }
    if (
      isWithin(APPLICATION_ROOT, target)
      || target === domainPublicIndex
      || target === domainPublicIndexWithExtension
      || target === domainPublicRoot
    ) {
      return undefined;
    }
    return "private or out-of-layer relative dependency";
  }

  if (
    normalized === "@/lib/project-intelligence"
    || normalized === "@/lib/project-intelligence/index"
    || normalized === "@/lib/project-intelligence/index.ts"
  ) {
    return undefined;
  }
  return "vendor/external SDK dependency";
}

function importViolations(files: readonly string[]): string[] {
  return files.flatMap((file) => moduleSpecifiers(readFileSync(file, "utf8"))
    .map((specifier) => ({ reason: forbiddenImportReason(file, specifier), specifier }))
    .filter((item): item is { reason: string; specifier: string } => item.reason !== undefined)
    .map(({ reason, specifier }) => `${repositoryPath(file)} imports ${specifier} (${reason})`));
}

function testOnlyExportViolations(indexFiles: readonly string[]): string[] {
  const testOnlyModule = /(?:^|[/.-])(?:__tests__|tests?|test-support|support|fixtures?|fakes?|mocks?|stubs?|in-?memory|memory)(?:[/.-]|$)/i;
  const testOnlyName = /(?:^|[a-z])(?:Test|Fake|Mock|Stub|Fixture|InMemory|Memory)(?:[A-Z_]|$)/;
  const violations: string[] = [];

  for (const indexFile of indexFiles) {
    const source = readFileSync(indexFile, "utf8");
    for (const specifier of moduleSpecifiers(source)) {
      if (testOnlyModule.test(specifier)) {
        violations.push(`${repositoryPath(indexFile)} exports test-only module ${specifier}`);
      }
    }

    const declaredExport = /\bexport\s+(?:declare\s+)?(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
    for (const match of source.matchAll(declaredExport)) {
      if (match[1] && testOnlyName.test(match[1])) {
        violations.push(`${repositoryPath(indexFile)} exports test-only symbol ${match[1]}`);
      }
    }

    const exportList = /\bexport\s+(?:type\s+)?\{([^}]+)\}/gs;
    for (const match of source.matchAll(exportList)) {
      for (const rawExport of (match[1] ?? "").split(",")) {
        const exportedName = rawExport.trim().split(/\s+as\s+/).at(-1)?.trim();
        if (exportedName && testOnlyName.test(exportedName)) {
          violations.push(`${repositoryPath(indexFile)} exports test-only symbol ${exportedName}`);
        }
      }
    }
  }

  return violations;
}

describe("Project Intelligence Architecture v1 frozen inputs", () => {
  it("uses the reproducible launch manifest shape and aggregate", () => {
    const manifest = readManifest();
    const paths = manifest.files.map(({ path }) => path);
    const canonicalEntries = canonicalManifestEntries(manifest.files);

    expect(manifest).toMatchObject({
      schemaVersion: "project-intelligence-frozen-input-manifest/1.0",
      hashAlgorithm: "sha256",
      canonicalEntryFormat: "<sha256>  <relative-path>\\n",
      fileCount: 51,
      aggregateSha256: LAUNCH_AGGREGATE_SHA256,
    });
    expect(paths).toEqual([...paths].sort());
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.every((path) => path.length > 0 && !path.startsWith("/") && !path.includes("\\"))).toBe(true);
    expect(manifest.files.every(({ sha256: hash }) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
    expect(manifest.fileCount).toBe(manifest.files.length);
    expect(sha256(canonicalEntries)).toBe(LAUNCH_AGGREGATE_SHA256);
  });

  it("contains every required architecture, contract, fixture and Wave 1 evidence input", () => {
    const manifestPaths = new Set(readManifest().files.map(({ path }) => path));

    expect(REQUIRED_FROZEN_PATHS.filter((path) => !manifestPaths.has(path))).toEqual([]);
    expect([...manifestPaths].some((path) => path.startsWith("lib/project-intelligence/application/"))).toBe(false);
  });

  it("matches every frozen file byte-for-byte without relying on Git", () => {
    const mismatches = readManifest().files.flatMap((entry) => {
      const absolutePath = resolve(REPOSITORY_ROOT, entry.path);
      if (!existsSync(absolutePath)) return [`${entry.path}: missing`];
      const actualHash = sha256(readFileSync(absolutePath));
      return actualHash === entry.sha256
        ? []
        : [`${entry.path}: expected ${entry.sha256}, received ${actualHash}`];
    });

    expect(mismatches).toEqual([]);
  });
});

describe("Project Intelligence Architecture v1 application boundary", () => {
  for (const track of APPLICATION_TRACKS) {
    const productionFiles = walkFiles(track.root).filter(isProductionTypeScript);

    it.skipIf(productionFiles.length === 0)(
      `${track.name} production files import only allowed application/domain/platform boundaries`,
      () => {
        expect(importViolations(productionFiles)).toEqual([]);
      },
    );
  }

  const productionIndexFiles = walkFiles(APPLICATION_ROOT)
    .filter((file) => isProductionTypeScript(file) && file.endsWith(`${sep}index.ts`));

  it.skipIf(productionIndexFiles.length === 0)(
    "production application indices do not export test adapters or test support",
    () => {
      expect(testOnlyExportViolations(productionIndexFiles)).toEqual([]);
    },
  );
});
