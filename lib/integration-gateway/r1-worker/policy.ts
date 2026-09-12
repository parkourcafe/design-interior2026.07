export const R1_WORKER_LIMITS = Object.freeze({ maxAttempts: 3, wallTimeSeconds: 300, vcpu: 4, memoryMiB: 8192, maxArchiveEntries: 2000, maxArchiveExpandedBytes: 500_000_000, maxArchiveRatio: 100 });

export function validateR1Archive(input: { readonly compressedBytes: number; readonly expandedBytes: number; readonly entries: readonly { path: string; kind: "file" | "directory" | "symlink"; encrypted?: boolean }[] }) {
  if (input.compressedBytes <= 0 || input.expandedBytes <= 0 || input.entries.length > R1_WORKER_LIMITS.maxArchiveEntries) throw new Error("r1_archive_limits_invalid");
  if (input.expandedBytes > R1_WORKER_LIMITS.maxArchiveExpandedBytes || input.expandedBytes / input.compressedBytes > R1_WORKER_LIMITS.maxArchiveRatio) throw new Error("r1_archive_expansion_rejected");
  const names = new Set<string>();
  for (const entry of input.entries) {
    const normalized = entry.path.replaceAll("\\", "/");
    if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..") || entry.kind === "symlink" || entry.encrypted || names.has(normalized)) throw new Error("r1_archive_entry_rejected");
    names.add(normalized);
  }
}
