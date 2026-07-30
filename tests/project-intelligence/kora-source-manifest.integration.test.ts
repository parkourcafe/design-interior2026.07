import { describe, expect, it } from "vitest";
import manifest from "./fixtures/pro-up-ru/kora-food-hall-source-manifest.json";

describe("Kora Food Hall construction source manifest", () => {
  it("covers the complete scoped physical inventory without widening into non-construction domains", () => {
    const roots = Object.values(manifest.sourceRoots);
    const physical = roots.reduce((total, root) => total + root.physical, 0);
    const materialized = roots.reduce((total, root) => total + root.materialized, 0);
    const placeholders = roots.reduce((total, root) => total + root.cloudPlaceholder, 0);
    const byStatus = roots.reduce(
      (totals, root) => ({
        current: totals.current + root.byStatus.current,
        previous: totals.previous + root.byStatus.previous,
        reference: totals.reference + root.byStatus.reference,
        unknown: totals.unknown + root.byStatus.unknown,
      }),
      { current: 0, previous: 0, reference: 0, unknown: 0 },
    );

    expect(physical).toBe(manifest.summary.physicalSources);
    expect(materialized).toBe(manifest.summary.materializedSources);
    expect(placeholders).toBe(manifest.summary.cloudPlaceholders);
    expect(materialized + placeholders).toBe(physical);
    expect(byStatus).toEqual(manifest.summary.byStatus);
    expect(Object.values(byStatus).reduce((total, value) => total + value, 0)).toBe(physical);
    expect(manifest.scope.excludedDomains).toEqual(
      expect.arrayContaining(["website", "marketing", "branding", "legal", "investor_outreach"]),
    );
  });

  it("exposes a stable sanitized UI inventory whose aggregates match the manifest summary", () => {
    expect(manifest.inventory).toHaveLength(manifest.summary.physicalSources);
    expect(new Set(manifest.inventory.map((item) => item.id)).size).toBe(manifest.inventory.length);
    expect(manifest.inventory.every((item) => /^kora-src-[a-f0-9]{16}$/.test(item.id))).toBe(true);
    expect(
      manifest.inventory.every(
        (item) =>
          !item.relativePath.startsWith("/") &&
          !item.relativePath.includes("/Users/") &&
          item.displayName.length > 0 &&
          Number.isInteger(item.sizeBytes) &&
          item.sizeBytes >= 0,
      ),
    ).toBe(true);

    const availability = manifest.inventory.reduce<Record<string, number>>((counts, item) => {
      counts[item.availability] = (counts[item.availability] ?? 0) + 1;
      return counts;
    }, {});
    const statuses = manifest.inventory.reduce<Record<string, number>>((counts, item) => {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
      return counts;
    }, {});
    const bytes = manifest.inventory.reduce((total, item) => total + item.sizeBytes, 0);

    expect(availability).toEqual({
      local: manifest.summary.materializedSources,
      cloud_placeholder: manifest.summary.cloudPlaceholders,
    });
    expect(statuses).toEqual(manifest.summary.byStatus);
    expect(bytes).toBe(manifest.summary.totalBytes);
    expect(
      manifest.inventory.every((item) =>
        ["local", "cloud_placeholder", "archive_member"].includes(item.availability),
      ),
    ).toBe(true);
    expect(
      manifest.inventory.every((item) =>
        ["current", "previous", "reference", "unknown"].includes(item.status),
      ),
    ).toBe(true);
    expect(
      manifest.inventory.every((item) =>
        item.availability === "cloud_placeholder"
          ? item.sha256 === null && item.duplicateGroup === null && item.hashAliases.length === 0
          : typeof item.sha256 === "string" && /^[a-f0-9]{64}$/.test(item.sha256),
      ),
    ).toBe(true);
  });

  it("deduplicates only materialized bytes and quarantines misleading renamed copies", () => {
    const hashEntries = Object.entries(manifest.exactHashIndex);
    const aliasedSources = hashEntries.flatMap(([, aliases]) => aliases);
    const duplicateGroups = hashEntries.filter(([, aliases]) => aliases.length > 1);

    expect(hashEntries).toHaveLength(manifest.summary.uniqueMaterializedBlobs);
    expect(aliasedSources).toHaveLength(manifest.summary.materializedSources);
    expect(new Set(aliasedSources).size).toBe(aliasedSources.length);
    expect(duplicateGroups).toHaveLength(manifest.summary.duplicateHashGroups);
    expect(manifest.semanticNameConflictHashes).toHaveLength(manifest.summary.semanticNameConflictGroups);

    for (const hash of manifest.semanticNameConflictHashes) {
      expect(manifest.exactHashIndex[hash as keyof typeof manifest.exactHashIndex].length).toBeGreaterThan(1);
      expect(
        manifest.inventory
          .filter((item) => item.sha256 === hash)
          .every((item) => item.semanticConflict && item.duplicateGroup === `sha256:${hash}`),
      ).toBe(true);
    }

    expect(
      manifest.exactHashIndex["7b3aba89803a32cf5c14e17f4aec0ebcfbd31774991ba2929dd010ac1d7d04a5"],
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("3D Exterior.pdf"),
        expect.stringContaining("AD05-101_Главная_лестница"),
      ]),
    );
    expect(manifest.importPolicy.semanticNameConflict).toBe("quarantine_until_visual_or_human_verification");
  });

  it("keeps archives and cloud placeholders out of automatic baseline approval", () => {
    expect(manifest.scope.productionUpload).toBe(false);
    expect(manifest.scope.baselineApproval).toBe("human_confirmation_required");
    expect(manifest.archiveInventory.dwgRestaurantSecondFloor).toMatchObject({
      dwgMembers: 24,
      bakMembers: 34,
      xlsxMembers: 1,
      automaticImport: ["dwg", "xlsx"],
      excludedFromAutomaticImport: ["bak"],
    });
    expect(manifest.importPolicy.cloudPlaceholder).toBe("inventory_only_until_materialized_and_hashed");
    expect(manifest.importPolicy.current).toBe("candidate_not_approval");
  });
});
