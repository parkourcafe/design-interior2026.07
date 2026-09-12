import { createRequire } from "node:module";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import type { SandboxIntent } from "./profile";

interface Statement {
  run(...args: (string | number | null)[]): { changes: number };
  get(...args: (string | number)[]): Record<string, unknown> | undefined;
  all(...args: (string | number)[]): Record<string, unknown>[];
}
interface Database { exec(sql: string): void; prepare(sql: string): Statement; close(): void }
const { DatabaseSync } = createRequire(process.execPath)("node:sqlite") as {
  DatabaseSync: new (path: string) => Database;
};
export type IntentState = "create_inflight" | "created" | "running" | "cleanup" | "cleanup_pending" | "ownership_conflict" | "settled";
export interface IntentRecord extends SandboxIntent {
  readonly supervisorPid: number; readonly revision: number; readonly state: IntentState; readonly containerId: string | null;
  readonly supervisorHeartbeat: number; readonly cancelRequested: boolean; readonly alert: string | null;
  readonly cleanupDeadlineMissedAt: number | null; readonly cleanupOutcome: "timely" | "late" | null;
  readonly lateCleanupOwner: string | null; readonly lateCleanupOwnerPid: number | null; readonly lateKillDeadline: number | null; readonly lateCleanupDeadline: number | null; readonly lateRetryAfter: number | null; readonly lateAttempts: number;
  readonly cleanupOwner: string | null; readonly cleanupOwnerPid: number | null; readonly cleanupKillDeadline: number | null; readonly cleanupDeadline: number | null; readonly cleanupLeaseUntil: number | null; readonly conflictAt: number | null; readonly reconcileAttempts: number;
}

/** A durable local-host registry, not the application DB or an in-memory lease substitute. */
export class SandboxRegistry {
  private readonly db: Database;
  constructor(path: string) {
    if (!isAbsolute(path)) throw new Error("sandbox_registry_path_invalid");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=250;
      CREATE TABLE IF NOT EXISTS intents (operation TEXT PRIMARY KEY, daemon TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_live_slot ON intents(daemon) WHERE state <> 'settled';
      CREATE TABLE IF NOT EXISTS watchdog (daemon TEXT PRIMARY KEY, boot TEXT NOT NULL, pid INTEGER NOT NULL, at INTEGER NOT NULL, pgid INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation TEXT NOT NULL, at INTEGER NOT NULL, payload TEXT NOT NULL);`);
    if (!this.db.prepare("PRAGMA table_info(watchdog)").all().some(column => column.name === "pgid")) this.db.exec("ALTER TABLE watchdog ADD COLUMN pgid INTEGER NOT NULL DEFAULT 0");
  }
  close() { this.db.close(); }
  read(operation: string): IntentRecord | null {
    const row = this.db.prepare("SELECT payload FROM intents WHERE operation=?").get(operation);
    return row ? JSON.parse(String(row.payload)) as IntentRecord : null;
  }
  live(daemon: string): IntentRecord[] {
    return this.db.prepare("SELECT payload FROM intents WHERE daemon=? AND state <> 'settled'").all(daemon).map(row => JSON.parse(String(row.payload)) as IntentRecord);
  }
  watchdogHeartbeat(daemon: string, boot: string, pid: number, now: number, pgid: number) {
    this.db.prepare("INSERT INTO watchdog VALUES(?,?,?,?,?) ON CONFLICT(daemon) DO UPDATE SET boot=excluded.boot,pid=excluded.pid,at=excluded.at,pgid=excluded.pgid").run(daemon, boot, pid, now, pgid);
  }
  assertWatchdog(daemon: string, boot: string, now: number, supervisorPid: number, supervisorGroup: number) {
    const row = this.db.prepare("SELECT boot,pid,at,pgid FROM watchdog WHERE daemon=?").get(daemon);
    if (!row || row.boot !== boot || Number(row.pid) === supervisorPid || Number(row.pgid) < 1 || Number(row.pgid) === supervisorGroup || now < Number(row.at) || now - Number(row.at) > 2_000) throw new Error("sandbox_watchdog_unavailable");
    try { process.kill(Number(row.pid), 0); } catch { throw new Error("sandbox_watchdog_unavailable"); }
  }
  async admit(intent: SandboxIntent, check: () => Promise<void>): Promise<IntentRecord> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.live(intent.daemonId).length) throw new Error("sandbox_slot_unavailable");
      await check();
      const record: IntentRecord = { ...intent, supervisorPid: process.pid, revision: 0, state: "create_inflight", containerId: null,
        supervisorHeartbeat: Date.now(), cancelRequested: false, alert: null, cleanupDeadlineMissedAt: null, cleanupOutcome: null, lateCleanupOwner: null, lateCleanupOwnerPid: null, lateKillDeadline: null, lateCleanupDeadline: null, lateRetryAfter: null, lateAttempts: 0, cleanupOwner: null, cleanupOwnerPid: null, cleanupKillDeadline: null, cleanupDeadline: null, cleanupLeaseUntil: null, conflictAt: null, reconcileAttempts: 0 };
      this.db.prepare("INSERT INTO intents VALUES(?,?,?,?,?)").run(intent.operationId, intent.daemonId, 0, record.state, JSON.stringify(record));
      this.db.prepare("INSERT INTO events(operation,at,payload) VALUES(?,?,?)").run(intent.operationId, Date.now(), JSON.stringify({ event: "creation_intent_committed", revision: 0 }));
      this.db.exec("COMMIT");
      return record;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  cas(record: IntentRecord, change: Partial<Pick<IntentRecord, "state" | "cleanupDeadlineMissedAt" | "cleanupOutcome" | "lateCleanupOwner" | "lateCleanupOwnerPid" | "lateKillDeadline" | "lateCleanupDeadline" | "lateRetryAfter" | "lateAttempts" | "cleanupOwner" | "cleanupOwnerPid" | "cleanupKillDeadline" | "cleanupDeadline" | "cleanupLeaseUntil" | "containerId" | "supervisorHeartbeat" | "cancelRequested" | "alert" | "conflictAt" | "reconcileAttempts">>): IntentRecord {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const stored = this.read(record.operationId);
      if (!stored || stored.revision !== record.revision) throw new Error("sandbox_stale_fence");
      // Cleanup deadlines belong to the original claim, not to its current owner.
      for (const field of ["cleanupKillDeadline", "cleanupDeadline", "cleanupDeadlineMissedAt"] as const) {
        if (stored[field] != null && Object.prototype.hasOwnProperty.call(change, field) && change[field] !== stored[field]) throw new Error("sandbox_cleanup_deadline_immutable");
      }
      if (stored.cleanupOutcome === "late" && Object.prototype.hasOwnProperty.call(change, "cleanupOutcome") && change.cleanupOutcome !== "late") throw new Error("sandbox_cleanup_outcome_sticky");
      const next = { ...stored, ...change, revision: stored.revision + 1 };
      if (next.cleanupDeadlineMissedAt != null && next.cleanupOutcome !== "late") throw new Error("sandbox_cleanup_outcome_sticky");
      if ((stored.lateAttempts ?? 0) === (next.lateAttempts ?? 0)) {
        for (const field of ["lateKillDeadline", "lateCleanupDeadline"] as const) {
          if (stored[field] != null && Object.prototype.hasOwnProperty.call(change, field) && change[field] !== stored[field]) throw new Error("sandbox_late_attempt_deadline_immutable");
        }
      }
      const result = this.db.prepare("UPDATE intents SET revision=?,state=?,payload=? WHERE operation=? AND revision=?")
        .run(next.revision, next.state, JSON.stringify(next), record.operationId, record.revision);
      if (result.changes !== 1) throw new Error("sandbox_stale_fence");
      this.db.prepare("INSERT INTO events(operation,at,payload) VALUES(?,?,?)").run(record.operationId, Date.now(), JSON.stringify({ event: next.state, revision: next.revision, alert: next.alert }));
      this.db.exec("COMMIT"); return next;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
