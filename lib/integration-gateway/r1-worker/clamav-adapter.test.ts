import { describe, expect, it } from "vitest";
import { scanWithR1ClamAv } from "./clamav-adapter";

describe("R1 ClamAV adapter", () => {
  const input = { executable: "clamscan", databaseDirectory: "/isolated/db", filePath: "/isolated/file", timeoutMs: 300_000 };
  it.each([[0, false, "clean"], [1, false, "infected"], [2, false, "scan_failed"], [null, false, "scan_failed"], [0, true, "scan_failed"]] as const)("fails closed for scanner result", async (exitCode, timedOut, expected) => {
    await expect(scanWithR1ClamAv({ run: async () => ({ exitCode, timedOut, output: "" }) }, input)).resolves.toBe(expected);
  });
  it("fails closed when the runner rejects or exceeds the adapter deadline", async () => {
    await expect(scanWithR1ClamAv({ run: async () => { throw new Error("spawn_failed"); } }, input)).resolves.toBe("scan_failed");
    await expect(scanWithR1ClamAv({ run: async () => new Promise(() => {}) }, { ...input, timeoutMs: 1 })).resolves.toBe("scan_failed");
  });
});
