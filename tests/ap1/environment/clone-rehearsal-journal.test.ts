import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createCloneRunJournal, inspectCloneRunJournal } from "../../../scripts/ops/clone-rehearsal-journal.mjs";

const binding = {
  targetRef: "reitdpzxtnmdkznesffu", runId: "36e7e04e-ec95-46d8-a936-44a3c0fb4be1",
  sourceCommit: "d5f21817f34f336e10c562a3515d5004711d25e5",
  manifestSha256: "bf772ca1d8253160310ea442068e49295dd172503f837fbf689a9f9fd6d10230",
  ledgerSha256: "9bc7e7b4efffffed76e69840393ada020eee156a61a769635cb4d2d2180e36ab",
  ownerCommandSha256: "3a951ba65a3ca0a67cde206a5fe0ee2204ef5cc41dfcf3c0d4d1f5fe7127e3c3",
  planSha256: "1".repeat(64), executorSha256: "2".repeat(64), fingerprintSha256: "3".repeat(64),
  historySha256: "4".repeat(64), auxiliarySha256: "5".repeat(64),
};
const owned: string[] = [];
function directory() { const p = mkdtempSync(join(tmpdir(), "clone-journal-test-")); chmodSync(p, 0o700); owned.push(p); return p; }
const event = (state: string, step = 0, remoteCommit: string | null = null, failure: string | null = null) => ({ state, step, remoteCommit, failure });
afterEach(() => { for (const p of owned.splice(0)) rmSync(p, { recursive: true }); });

describe("supplemental clone journal", () => {
  it("sanitizes missing directory and invalid path inputs before filesystem errors escape", () => {
    const missing = join(directory(), "private-location-not-for-output");
    expect(() => createCloneRunJournal({ directory: missing, binding })).toThrow(/^CLONE_JOURNAL_DIRECTORY_UNAVAILABLE$/);
    for (const directory of [null, 42, {}, "relative-private-path"]) {
      expect(() => createCloneRunJournal({ directory, binding })).toThrow(/^CLONE_JOURNAL_DIRECTORY_INVALID$/);
    }
  });
  it("persists sequential staged progress and one commit intent, and cannot resume success", () => {
    const dir = directory(); const journal = createCloneRunJournal({ directory: dir, binding });
    try {
      journal.append(event("ARMED", 0, "a".repeat(40)));
      for (let step = 1; step <= 97; step++) journal.append(event("STAGED", step));
      journal.append(event("COMMIT_INTENT", 97)); journal.append(event("SUCCEEDED", 97));
      expect(() => journal.append(event("STAGED", 1))).toThrow("TERMINAL");
    } finally { journal.close(); }
    const inspected = inspectCloneRunJournal(journal.path);
    expect(inspected).toMatchObject({ resumeAllowed: false, lastState: "SUCCEEDED", stagedCount: 97, evidenceClass: "LOCAL_JOURNAL" });
    expect(() => createCloneRunJournal({ directory: dir, binding })).toThrow("EXISTS_OR_UNAVAILABLE");
  });

  it("rejects skipped/repeated steps and commit before every staged migration", () => {
    const journal = createCloneRunJournal({ directory: directory(), binding });
    try {
      expect(() => journal.append(event("STAGED", 1))).toThrow("TRANSITION_INVALID");
      journal.append(event("ARMED", 0, "a".repeat(40)));
      expect(() => journal.append(event("STAGED", 2))).toThrow("TRANSITION_INVALID");
      journal.append(event("STAGED", 1));
      expect(() => journal.append(event("STAGED", 1))).toThrow("TRANSITION_INVALID");
      expect(() => journal.append(event("COMMIT_INTENT", 97))).toThrow("TRANSITION_INVALID");
      journal.append(event("FAILED", 1, null, "DB_ERROR"));
    } finally { journal.close(); }
    expect(inspectCloneRunJournal(journal.path)).toMatchObject({ lastState: "FAILED", resumeAllowed: false });
  });

  it("retains fsynced evidence after actual process death and refuses another creation", () => {
    const dir = directory();
    const journalModuleUrl = pathToFileURL(resolve(__dirname, "../../../scripts/ops/clone-rehearsal-journal.mjs")).href;
    const script = `import {createCloneRunJournal} from ${JSON.stringify(journalModuleUrl)}; const j=createCloneRunJournal(${JSON.stringify({ directory: dir, binding })}); j.append(${JSON.stringify(event("ARMED", 0, "a".repeat(40)))}); j.append(${JSON.stringify(event("STAGED", 1))}); process.kill(process.pid, 'SIGKILL');`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { timeout: 5000, encoding: "utf8" });
    expect(result.error).toBeUndefined(); expect(result.signal).toBe("SIGKILL");
    expect(inspectCloneRunJournal(join(dir, `${binding.targetRef}.jsonl`))).toMatchObject({ lastState: "STAGED", stagedCount: 1, resumeAllowed: false });
    expect(() => createCloneRunJournal({ directory: dir, binding })).toThrow("EXISTS_OR_UNAVAILABLE");
  });

  it("rejects target substitution and any additional disclosure fields before creation", () => {
    const dir = directory();
    for (const changed of [ { ...binding, targetRef: "ztnycrchwxqczqbyegnp" }, { ...binding, sourceCommit: "a".repeat(40) }, { ...binding, connection: "not-permitted" }, { ...binding, planSha256: { toString: () => "1".repeat(64) } } ]) {
      expect(() => createCloneRunJournal({ directory: dir, binding: changed })).toThrow("CLONE_JOURNAL_");
    }
    const journal = createCloneRunJournal({ directory: dir, binding });
    try { expect(() => journal.append({ ...event("FAILED", 0, null, "DB_ERROR"), detail: "database output" })).toThrow("EVENT_INVALID"); }
    finally { journal.close(); }
    expect(readFileSync(journal.path, "utf8")).not.toContain("database output");
  });

  it("fails closed on torn writes and altered hash-chain records", () => {
    const journal = createCloneRunJournal({ directory: directory(), binding }); journal.close();
    const original = readFileSync(journal.path, "utf8");
    writeFileSync(journal.path, original + '{"sequence":1');
    expect(() => inspectCloneRunJournal(journal.path)).toThrow("UNCERTAIN");
    writeFileSync(journal.path, original.replace('"step":0', '"step":1'));
    expect(() => inspectCloneRunJournal(journal.path)).toThrow("CORRUPT");
  });

  it("rejects symlinks, broad permissions and replacement of the journal inode", () => {
    const dir = directory(); const journal = createCloneRunJournal({ directory: dir, binding });
    const saved = readFileSync(journal.path);
    try {
      chmodSync(journal.path, 0o644);
      expect(() => inspectCloneRunJournal(journal.path)).toThrow("FILE_UNSAFE");
      chmodSync(journal.path, 0o600);
      const link = join(dir, "linked.jsonl"); symlinkSync(journal.path, link);
      expect(() => inspectCloneRunJournal(link)).toThrow("READ_UNAVAILABLE");
      rmSync(journal.path); writeFileSync(journal.path, saved, { mode: 0o600 });
      expect(() => journal.append(event("ARMED", 0, "a".repeat(40)))).toThrow("WRITE_UNCERTAIN");
      expect(() => journal.append(event("ARMED", 0, "a".repeat(40)))).toThrow("UNAVAILABLE");
    } finally { journal.close(); }
  });
});
