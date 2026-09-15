import { describe, expect, it } from "vitest";
import {
  buildR1BrowserManifest,
  R1_BROWSER_MANIFEST_MAX_ENTRIES,
  R1_BROWSER_MANIFEST_VERSION,
} from "./browser-manifest";

const projectId = "11111111-1111-4111-8111-111111111111";
const packageId = "22222222-2222-4222-8222-222222222222";
const submissionId = "33333333-3333-4333-8333-333333333333";
const evidenceId = "44444444-4444-4444-8444-444444444444";
const assetVersionId = "55555555-5555-4555-8555-555555555555";
const representationA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const representationB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const digestA = `sha256:${"a".repeat(64)}`;
const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const glbEntry = {
  assetVersionId,
  representationVersionId: representationB,
  representationDigest: digestA,
  versionNo: 2,
  format: "glb",
  status: "current",
  displayLabel: "Модель · ревизия 2",
  transform: { kind: "3d", units: "m", upAxis: "Y", matrix: identityMatrix },
} as const;

const pdfEntry = {
  assetVersionId,
  representationVersionId: representationA,
  representationDigest: `sha256:${"b".repeat(64)}`,
  versionNo: 1,
  format: "pdf",
  status: "superseded",
  displayLabel: "Лист A-101",
  transform: {
    kind: "2d",
    page: 3,
    rotation: 90,
    crop: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  },
} as const;

const baseInput = {
  contractVersion: R1_BROWSER_MANIFEST_VERSION,
  projection: {
    source: "structural_manifest_input",
    evidenceId,
    scopeRevision: 7,
    evaluatedAt: "2026-09-16T00:00:00Z",
  },
  scope: { mode: "authenticated_review", projectId, packageId, submissionId },
  accessLifecycle: "active",
  entries: [glbEntry, pdfEntry],
} as const;

describe("R1 filtered private browser manifest", () => {
  it("emits deterministic exact entries without claiming broker authorization", () => {
    const manifest = buildR1BrowserManifest(baseInput);
    expect(manifest.entries.map((entry) => entry.representationVersionId)).toEqual([
      representationA,
      representationB,
    ]);
    expect(manifest).toMatchObject({
      authorizationDisposition: "broker_recheck_required",
      accessLifecycle: "active",
      deliveryRequirements: {
        cacheControl: "private, no-store",
        requireAuthorizationPerGetAndRange: true,
        maximumOpenStreamRecheckMs: 1_000,
        prohibitRawStorageLocator: true,
      },
    });
    for (const entry of manifest.entries) {
      expect(entry).not.toHaveProperty("storageKey");
      expect(entry).not.toHaveProperty("storageLocator");
      expect(entry).not.toHaveProperty("sourceUrl");
      expect(entry).not.toHaveProperty("rawToken");
      expect(entry).not.toHaveProperty("filename");
    }
  });

  it.each(["grace_read_only", "archive_read_only"] as const)("keeps %s distinct from authorization", (accessLifecycle) => {
    expect(buildR1BrowserManifest({ ...baseInput, accessLifecycle })).toMatchObject({
      accessLifecycle,
      authorizationDisposition: "broker_recheck_required",
    });
  });

  it("rejects revoked access before returning entries", () => {
    expect(() => buildR1BrowserManifest({ ...baseInput, accessLifecycle: "revoked" }))
      .toThrow("revoked");
  });

  it("supports exact guest release scope without a raw token", () => {
    const releaseId = "66666666-6666-4666-8666-666666666666";
    const grantId = "77777777-7777-4777-8777-777777777777";
    expect(buildR1BrowserManifest({
      ...baseInput,
      scope: { mode: "guest_release", projectId, packageId, releaseId, grantId },
    }).scope).toEqual({ mode: "guest_release", projectId, packageId, releaseId, grantId });
  });

  it("supports a page-less PNG crop", () => {
    const png = {
      ...pdfEntry,
      format: "png",
      transform: { ...pdfEntry.transform, page: null, rotation: 0 },
    } as const;
    expect(buildR1BrowserManifest({ ...baseInput, entries: [png] }).entries[0]?.transform)
      .toMatchObject({ kind: "2d", page: null, rotation: 0 });
  });

  it("rejects accessors, symbols, custom prototypes and input-owned array methods", () => {
    const accessorInput = {
      ...baseInput,
      get accessLifecycle() { return "active"; },
    };
    expect(() => buildR1BrowserManifest(accessorInput)).toThrow("validation_failed");

    const accessorEntry = {
      ...glbEntry,
      get representationDigest() { return digestA; },
    };
    expect(() => buildR1BrowserManifest({ ...baseInput, entries: [accessorEntry] }))
      .toThrow("validation_failed");

    const entries = [glbEntry];
    Object.defineProperty(entries, "map", { value: () => [{ signedUrl: "https://storage.invalid" }] });
    expect(() => buildR1BrowserManifest({ ...baseInput, entries })).toThrow("validation_failed");

    const symbolInput = { ...baseInput } as typeof baseInput & { [key: symbol]: string };
    symbolInput[Symbol("rawToken")] = "secret";
    expect(() => buildR1BrowserManifest(symbolInput)).toThrow("validation_failed");

    const customPrototype = Object.assign(Object.create({ rawToken: "secret" }), baseInput);
    expect(() => buildR1BrowserManifest(customPrototype)).toThrow("validation_failed");
  });

  it("uses one array length descriptor snapshot for the 500-entry bound", () => {
    const entries = new Proxy(new Array(R1_BROWSER_MANIFEST_MAX_ENTRIES + 1).fill(glbEntry), {
      get(target, property, receiver) {
        if (property === "length") return 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => buildR1BrowserManifest({ ...baseInput, entries })).toThrow("validation_failed");
  });

  it.each([
    ["unknown contract", { ...baseInput, contractVersion: "r1-browser-manifest/9.9" }],
    ["empty entries", { ...baseInput, entries: [] }],
    ["oversized entries", { ...baseInput, entries: new Array(R1_BROWSER_MANIFEST_MAX_ENTRIES + 1).fill(glbEntry) }],
    ["unknown top-level key", { ...baseInput, signedUrl: "https://storage.invalid/object" }],
    ["invalid projection source", { ...baseInput, projection: { ...baseInput.projection, source: "upload" } }],
    ["invalid projection id", { ...baseInput, projection: { ...baseInput.projection, evidenceId: "x" } }],
    ["invalid projection revision", { ...baseInput, projection: { ...baseInput.projection, scopeRevision: -1 } }],
    ["malformed calendar timestamp", { ...baseInput, projection: { ...baseInput.projection, evaluatedAt: "2026-02-31T00:00:00Z" } }],
    ["mixed review scope", { ...baseInput, scope: { ...baseInput.scope, releaseId: undefined } }],
    ["guest raw token", { ...baseInput, scope: { mode: "guest_release", projectId, packageId, releaseId: evidenceId, grantId: assetVersionId, rawToken: "x" } }],
    ["duplicate representation", { ...baseInput, entries: [glbEntry, glbEntry] }],
    ["raw entry locator", { ...baseInput, entries: [{ ...glbEntry, storageKey: "private/file" }] }],
    ["invalid digest", { ...baseInput, entries: [{ ...glbEntry, representationDigest: "x" }] }],
    ["unsafe label path", { ...baseInput, entries: [{ ...glbEntry, displayLabel: "private/model.glb" }] }],
    ["unsafe label scheme", { ...baseInput, entries: [{ ...glbEntry, displayLabel: "javascript:alert(1)" }] }],
    ["original filename-shaped label", { ...baseInput, entries: [{ ...glbEntry, displayLabel: "Ivanov-plan.pdf" }] }],
    ["bidi label", { ...baseInput, entries: [{ ...glbEntry, displayLabel: "safe\u202Efdp.exe" }] }],
    ["PDF with 3D transform", { ...baseInput, entries: [{ ...pdfEntry, transform: glbEntry.transform }] }],
    ["GLB with 2D transform", { ...baseInput, entries: [{ ...glbEntry, transform: pdfEntry.transform }] }],
    ["sparse 3D matrix", { ...baseInput, entries: [{ ...glbEntry, transform: { ...glbEntry.transform, matrix: new Array(16) } }] }],
    ["sparse entries", { ...baseInput, entries: new Array(1) }],
    ["fractional PDF page", { ...baseInput, entries: [{ ...pdfEntry, transform: { ...pdfEntry.transform, page: 1.5 } }] }],
    ["crop overflow", { ...baseInput, entries: [{ ...pdfEntry, transform: { ...pdfEntry.transform, crop: { x: 0.8, y: 0, width: 0.3, height: 1 } } }] }],
    ["subnormal crop", { ...baseInput, entries: [{ ...pdfEntry, transform: { ...pdfEntry.transform, crop: { x: 1, y: 0, width: Number.MIN_VALUE, height: 1 } } }] }],
  ] as const)("fails closed for %s", (_name, input) => {
    expect(() => buildR1BrowserManifest(input)).toThrow("validation_failed");
  });
});
