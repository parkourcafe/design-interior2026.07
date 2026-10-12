import { execFile, type ExecFileException } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasSet, installBackupShims, syntheticSet } from "./helpers/backup-shim";

// Решение владельца 11.10.2026, п. 1: при запуске контейнера сначала снимается
// и проверяется новая копия, потом уборка по сроку без исключений. Отказ —
// «резервное копирование не выполнено», ненулевой код; отсутствие пригодной
// копии — критический сбой. Срок хранения не меняется.
// Управляющая логика — на подменах команд (helpers/backup-shim.ts); настоящие
// pg_dump/pg_restore — отдельный прогон в контейнере postgres:17-alpine.

const SCRIPT = resolve(__dirname, "../../deploy/self-hosted/backup.sh");
const DAY = 86_400;
const T = 14 * DAY;
const NOW = Date.UTC(2026, 9, 11, 3, 0, 0) / 1000;

function stampFor(epoch: number): string {
  const d = new Date(epoch * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

let root: string; let dir: string; let storage: string; let bin: string; let fail: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "backup-start-"));
  dir = join(root, "backups"); storage = join(root, "storage"); bin = join(root, "bin"); fail = join(root, "fail");
  for (const d of [dir, storage]) rmSync(d, { recursive: true, force: true });
  installBackupShims(bin, fail);
  mkdirSync(storage, { recursive: true });
  writeFileSync(join(storage, "client.bin"), "SYNTHETIC-STORAGE");
  mkdirSync(dir, { recursive: true });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function run(mode: "backup-once" | "cleanup-once", now = NOW, env: Record<string, string> = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((ok) => {
    execFile("sh", [SCRIPT], {
      env: { PATH: `${bin}:${process.env.PATH ?? ""}`, NODE_ENV: "test", BACKUP_MODE: mode, BACKUP_DIR: dir, BACKUP_STORAGE_DIR: storage, BACKUP_NOW_EPOCH: String(now), ...env },
    }, (error: ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => {
      ok({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, out: stdout.toString(), err: stderr.toString() });
    });
  });
}
const status = () => readFileSync(join(dir, "backup-status"), "utf8").trim();
const log = () => (existsSync(join(dir, "retention.log")) ? readFileSync(join(dir, "retention.log"), "utf8") : "");

describe("backup at container start (owner decision 11.10.2026 §1)", () => {
  it("takes, verifies and marks a copy, then reports BACKUP_OK with exit 0", async () => {
    const r = await run("backup-once");
    const stamp = stampFor(NOW);
    expect(r.code).toBe(0);
    expect(hasSet(dir, stamp)).toBe(true);
    expect(existsSync(join(dir, `verified-${stamp}.ok`))).toBe(true);
    expect(readdirSync(dir).some((n) => n.endsWith(".part"))).toBe(false);
    expect(status()).toMatch(new RegExp(`BACKUP_OK ${stamp}$`));
    expect(r.out).toContain(`пригодная копия: ${stamp}`);
  });

  it("on pg_dump failure: no partial set, explicit message, non-zero code, status BACKUP_FAILED; an older usable copy keeps it from being critical", async () => {
    const older = stampFor(NOW - 2 * DAY);
    syntheticSet(dir, older, { verified: true });
    writeFileSync(join(fail, "pg_dump"), "");
    const r = await run("backup-once");
    const stamp = stampFor(NOW);
    expect(r.code).toBe(70);
    expect(r.err).toContain("резервное копирование не выполнено");
    expect(r.err).toContain(`BACKUP_FAILED ${stamp}`);
    expect(readdirSync(dir).filter((n) => n.includes(stamp))).toEqual([]);
    expect(status()).toMatch(/BACKUP_FAILED/);
    expect(log()).toMatch(/BACKUP_FAILED/);
    expect(hasSet(dir, older)).toBe(true);
    expect(r.out).toContain(`пригодная копия: ${older}`);
  });

  it("failure with no usable copy left is BACKUP_CRITICAL with exit 71", async () => {
    writeFileSync(join(fail, "pg_dumpall"), "");
    const r = await run("backup-once");
    expect(r.code).toBe(71);
    expect(r.err).toContain("резервное копирование не выполнено");
    expect(r.err).toContain("BACKUP_CRITICAL");
    expect(status()).toMatch(/BACKUP_CRITICAL no_usable_copy$/);
    expect(log()).toMatch(/BACKUP_CRITICAL no_usable_copy/);
  });

  it("a copy that was written but fails full-read verification is removed and counts as not taken", async () => {
    writeFileSync(join(fail, "pg_restore_fullread"), "");
    const r = await run("backup-once");
    const stamp = stampFor(NOW);
    expect(r.code).toBe(71);
    expect(hasSet(dir, stamp)).toBe(false);
    expect(existsSync(join(dir, `verified-${stamp}.ok`))).toBe(false);
    expect(r.err).toContain("дамп не читается целиком");
    expect(status()).toMatch(/BACKUP_CRITICAL/);
  });

  it("overdue copies are deleted even when the new copy fails; copies within the limit are kept; retention is unchanged", async () => {
    const overdue = stampFor(NOW - T - 3600);          // старше T: нарушение, удаляется
    const beyondThreshold = stampFor(NOW - T + 3600);  // между T−Δ и T: удаляется по порогу
    const kept = stampFor(NOW - 5 * DAY);
    syntheticSet(dir, overdue, { verified: true });
    syntheticSet(dir, beyondThreshold, { verified: true });
    syntheticSet(dir, kept, { verified: true });
    writeFileSync(join(fail, "pg_dump"), "");
    const r = await run("backup-once");
    expect(r.code).toBe(70);
    expect(r.err).toContain(`RETENTION_OVERDUE db-${overdue}.dump`);
    expect(readdirSync(dir).some((n) => n.includes(overdue))).toBe(false);
    expect(readdirSync(dir).some((n) => n.includes(beyondThreshold))).toBe(false);
    expect(hasSet(dir, kept)).toBe(true);
    expect(existsSync(join(dir, `verified-${kept}.ok`))).toBe(true);
    // Порог и срок — прежние (T−Δ = 13 суток, T = 14 суток).
    expect(log()).toMatch(/threshold=1123200s limit=1209600s/);
  });

  it("an older set without a marker is verified once and accepted as usable; a broken one is not", async () => {
    const good = stampFor(NOW - 3 * DAY);
    const bad = stampFor(NOW - 1 * DAY);
    syntheticSet(dir, good);
    syntheticSet(dir, bad, { broken: "dump" });
    writeFileSync(join(fail, "pg_dump"), "");
    const r = await run("backup-once");
    expect(r.code).toBe(70);
    expect(r.out).toContain(`пригодная копия: ${good}`);
    expect(existsSync(join(dir, `verified-${good}.ok`))).toBe(true);
    expect(existsSync(join(dir, `verified-${bad}.ok`))).toBe(false);
  });

  it("cleanup-once alone reports the critical state when nothing usable remains", async () => {
    syntheticSet(dir, stampFor(NOW - T - DAY), { verified: true });
    const r = await run("cleanup-once");
    expect(r.code).toBe(71);
    expect(r.err).toContain("BACKUP_CRITICAL");
    expect(readdirSync(dir).filter((n) => n.startsWith("db-"))).toEqual([]);
  });

  it("refuses a retry interval under a minute and a retention of one day", async () => {
    expect((await run("backup-once", NOW, { BACKUP_RETRY_SECONDS: "5" })).code).toBe(64);
    expect((await run("backup-once", NOW, { BACKUP_RETENTION_DAYS: "1" })).code).toBe(64);
  });
});
