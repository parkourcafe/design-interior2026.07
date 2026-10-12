import { execFile, execFileSync, type ExecFileException } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installBackupShims, syntheticSet } from "./helpers/backup-shim";

// ТЗ 08.10, FIX-05: срок хранения ночных копий (DEC-047(f): 14 дней).
// T = 14 × 86 400 с; уборка раз в Δ = 86 400 с удаляет всё старше T − Δ, так что
// перед следующей уборкой ни одна копия не старше T. Проверки — только на
// временных синтетических файлах, через настоящий backup.sh в режиме cleanup-once.

const SCRIPT = resolve(__dirname, "../../deploy/self-hosted/backup.sh");
const DAY = 86_400;
const T = 14 * DAY;
const DELTA = DAY;
const NOW = Date.UTC(2026, 9, 8, 0, 0, 0) / 1000; // 08.10.2026 00:00 UTC — время ночной уборки

function stampFor(epoch: number): string {
  const d = new Date(epoch * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

let dir: string; let bin: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "retention-"));
  // С 11.10 уборка заканчивается проверкой «есть ли пригодная копия»: наборы
  // должны проходить verify_set (подмены pg_restore, настоящие tar/gzip).
  bin = join(dir, ".bin"); installBackupShims(bin, join(dir, ".fail"));
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** Синтетический набор копии с временем создания в имени (проверяемой формы). */
function copyAt(epoch: number): string {
  const stamp = stampFor(epoch);
  syntheticSet(dir, stamp, { verified: true });
  return stamp;
}
const present = (stamp: string) => existsSync(join(dir, `db-${stamp}.dump`))
  && existsSync(join(dir, `roles-${stamp}.sql`)) && existsSync(join(dir, `storage-${stamp}.tar.gz`));
const anyOf = (stamp: string) => readdirSync(dir).some((n) => n.includes(stamp));

function cleanup(now: number, env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  return new Promise((ok) => {
    execFile("sh", [SCRIPT], {
      env: { PATH: `${bin}:${process.env.PATH ?? ""}`, NODE_ENV: "test", BACKUP_MODE: "cleanup-once", BACKUP_DIR: dir, BACKUP_NOW_EPOCH: String(now), ...env },
    }, (error: ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => {
      ok({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, out: `${stdout.toString()}${stderr.toString()}` });
    });
  });
}

// backup.sh работает в postgres:17-alpine (busybox date -d). На хосте без
// такого date (BSD/macOS) проверка не выполняется — это не ошибка скрипта.
const dateParsesEpoch = (() => {
  try { return execFileSync("date", ["-u", "-d", "@0", "+%s"], { encoding: "utf8" }).trim() === "0"; } catch { return false; }
})();

describe.skipIf(!dateParsesEpoch)("backup retention (FIX-05)", () => {
  it("removes copies older than T − Δ and keeps younger ones, on both sides of the threshold", async () => {
    // Имена с точностью до минуты: возраст считается от минуты создания.
    const young = copyAt(NOW - 2 * DAY);
    const justUnder = copyAt(NOW - (T - DELTA) + 60);
    const exactlyAt = copyAt(NOW - (T - DELTA));
    const justOver = copyAt(NOW - (T - DELTA) - 60);
    const atT = copyAt(NOW - T);
    const r = await cleanup(NOW);
    expect(r.code).toBe(0);
    expect(present(young)).toBe(true);
    expect(present(justUnder)).toBe(true);
    expect(present(exactlyAt)).toBe(true);
    expect(anyOf(justOver)).toBe(false);
    expect(anyOf(atT)).toBe(false);
  });

  it("removes a 14.9-day-old copy (the find -mtime +14 finding) and records it as overdue", async () => {
    const old = copyAt(NOW - Math.round(14.9 * DAY));
    const r = await cleanup(NOW);
    // Единственная копия удалена → пригодной не осталось: с 11.10 это критический сбой (71).
    expect(r.code).toBe(71);
    expect(r.out).toContain("BACKUP_CRITICAL");
    expect(anyOf(old)).toBe(false);
    expect(r.out).toContain("RETENTION_OVERDUE");
    expect(readFileSync(join(dir, "retention.log"), "utf8")).toMatch(/RETENTION_OVERDUE db-\d{8}-\d{4}\.dump/);
  });

  it("no copy reaches T just before the next scheduled cleanup", async () => {
    // Копии каждые 6 часов за 20 суток до уборки.
    for (let h = 0; h < 20 * 24; h += 6) copyAt(NOW - h * 3600);
    await cleanup(NOW);
    const justBeforeNext = NOW + DELTA - 1;
    const ages = readdirSync(dir).filter((n) => n.startsWith("db-")).map((n) => {
      const m = /^db-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.dump$/.exec(n)!;
      return justBeforeNext - Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) / 1000;
    });
    expect(Math.max(...ages)).toBeLessThanOrEqual(T);
    // Окно доступности: сразу после уборки есть копии за последние T − Δ.
    expect(Math.max(...ages)).toBeGreaterThan(T - DELTA - 6 * 3600);
    const r = await cleanup(NOW + DELTA);
    expect(r.out).not.toContain("RETENTION_OVERDUE");
  }, 60_000);

  it("after a missed run (server stopped for three days) the first cleanup removes and flags overdue copies", async () => {
    for (let d = 0; d < 13; d += 1) copyAt(NOW - d * DAY);
    await cleanup(NOW);
    const resumed = NOW + 3 * DELTA; // ни одной уборки за трое суток
    const r = await cleanup(resumed);
    expect(r.code).toBe(0); // копии за последние 10 суток остаются пригодными
    expect(r.out).toContain("RETENTION_OVERDUE");
    const remaining = readdirSync(dir).filter((n) => n.startsWith("db-"));
    for (const n of remaining) {
      const m = /^db-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.dump$/.exec(n)!;
      expect(resumed - Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) / 1000).toBeLessThanOrEqual(T - DELTA);
    }
  });

  it("leaves unknown files alone, drops stale .part leftovers and refuses a retention of one day", async () => {
    copyAt(NOW - DAY); // пригодная копия есть: уборка не считается критической
    writeFileSync(join(dir, "notes.txt"), "keep");
    const part = join(dir, `db-${stampFor(NOW)}.dump.part`);
    writeFileSync(part, "partial");
    utimesSync(part, new Date(Date.now() - 2 * 3600 * 1000), new Date(Date.now() - 2 * 3600 * 1000));
    const r = await cleanup(NOW);
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, "notes.txt"))).toBe(true);
    expect(existsSync(part)).toBe(false);
    expect((await cleanup(NOW, { BACKUP_RETENTION_DAYS: "1" })).code).toBe(64);
  });
});
