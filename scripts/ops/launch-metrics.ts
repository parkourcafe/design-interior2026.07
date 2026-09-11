/** Owner-run only. Fixtures never establish adoption, payment or provider billing. */
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { launchMetrics } from "../../lib/analytics/launch-metrics";

const snapshotSchema = z.object({
  events: z.array(z.object({ type: z.string(), project_id: z.string().nullable(), created_at: z.string().datetime({ offset: true }) })),
  ai_calls: z.array(z.object({ module: z.string(), project_id: z.string().nullable(), status: z.enum(["ok", "error"]), cost_rub: z.union([z.number(), z.string(), z.null()]) })),
});

export async function main(args = process.argv.slice(2)) {
  let snapshot: unknown;
  let source: "FIXTURE" | "OWNER_READ_ONLY_SNAPSHOT";
  let window: { from: string; to: string } | null = null;
  if (args.length === 2 && args[0] === "--fixture" && args[1]) {
    snapshot = JSON.parse(await readFile(args[1], "utf8"));
    source = "FIXTURE";
  } else if (args.length === 3 && args[0] === "--database") {
    const from = z.string().datetime({ offset: true }).parse(args[1]);
    const to = z.string().datetime({ offset: true }).parse(args[2]);
    if (Date.parse(from) >= Date.parse(to)) throw new Error("invalid_window");
    const url = process.env.LAUNCH_METRICS_DATABASE_URL;
    if (!url || !["postgres:", "postgresql:"].includes(new URL(url).protocol)) throw new Error("read_only_url_required");
    window = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
    // Constant SELECTs only, bounded window, read-only consistent transaction.
    // URL goes through the subprocess environment, never argv, stdout or errors.
    const sql = `begin isolation level repeatable read read only;
set local statement_timeout = '30s';
select json_build_object(
 'events', coalesce((select json_agg(e) from (select type, project_id, created_at from public.events where created_at >= '${window.from}' and created_at < '${window.to}') e), '[]'::json),
 'ai_calls', coalesce((select json_agg(c) from (select module, project_id, status, cost_rub::text as cost_rub from projectceo_platform.ai_calls where created_at >= '${window.from}' and created_at < '${window.to}' and module in ('brief','risks','proposal')) c), '[]'::json));
rollback;`;
    snapshot = JSON.parse(execFileSync("psql", ["-X", "-qAt", "--no-password", "-v", "ON_ERROR_STOP=1"], {
      input: sql, encoding: "utf8", timeout: 40_000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, PGDATABASE: url, PGOPTIONS: "-c default_transaction_read_only=on", PGCONNECT_TIMEOUT: "10" },
      stdio: ["pipe", "pipe", "pipe"],
    }));
    source = "OWNER_READ_ONLY_SNAPSHOT";
  } else throw new Error("usage: --fixture snapshot.json OR --database FROM_ISO TO_ISO");
  const input = snapshotSchema.parse(snapshot);
  return { source, window, ...launchMetrics(input.events, input.ai_calls),
    limitations: ["Window-bound cohort; projects without a link event excluded from activation.", "Counts are unique projects, not people or payments.", "AI totals cover recorded rows only; missing telemetry and invoice reconciliation require owner evidence.", "Null cost is unknown, never zero; per-passport cost is not inferred from unscoped calls."] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((report) => console.log(JSON.stringify(report, null, 2))).catch(() => {
    // Do not print DB error objects: connection strings can contain credentials.
    console.error("launch_metrics_failed: verify arguments, fixture schema or read-only database access");
    process.exitCode = 1;
  });
}
