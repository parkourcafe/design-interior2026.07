/** Shared, deterministic formulas. No database access or raw project data in output. */
export const activationStages = ["intake_link_created", "brief_started", "brief_completed", "proposal_created", "proposal_sent"] as const;
export const launchErrorTypes = ["intake_start_failed", "intake_submit_failed", "intake_upload_failed", "proposal_respond_failed", "proposal_create_failed", "proposal_save_failed", "proposal_rebuild_failed", "proposal_send_failed", "intake_ai_fallback"] as const;
export interface LaunchEvent { type: string; project_id: string | null; created_at: string }
export interface LaunchAiCall { module: string; project_id: string | null; status: string; cost_rub: number | string | null }

export function activationMetrics(events: readonly LaunchEvent[]) {
  const projects = new Map<string, Map<string, number[]>>();
  let invalidEvents = 0;
  for (const event of events) {
    const time = Date.parse(event.created_at);
    if (!event.project_id || !Number.isFinite(time)) { invalidEvents++; continue; }
    const project = projects.get(event.project_id) ?? new Map<string, number[]>();
    project.set(event.type, [...(project.get(event.type) ?? []), time].sort((a, b) => a - b));
    projects.set(event.project_id, project);
  }
  // A cohort of unique projects with a link event; repeat submissions cannot inflate conversion.
  const cohort = [...projects.values()].filter((p) => p.has(activationStages[0]));
  const counts = Object.fromEntries(activationStages.map((type) => [type, 0])) as Record<typeof activationStages[number], number>;
  for (const project of cohort) {
    let previous = -Infinity;
    for (const stage of activationStages) {
      const time = project.get(stage)?.find((value) => value >= previous);
      if (time === undefined) break;
      counts[stage]++;
      previous = time;
    }
  }
  function duration(start: string, end: string) {
    const values: number[] = [];
    for (const project of cohort) {
      const first = project.get(start)?.[0];
      if (first === undefined) continue;
      const finish = project.get(end)?.find((time) => time >= first);
      if (finish !== undefined) values.push(finish - first);
    }
    values.sort((a, b) => a - b);
    return { samples: values.length, meanMs: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
      medianMs: values.length ? (values[Math.floor((values.length - 1) / 2)]! + values[Math.floor(values.length / 2)]!) / 2 : null };
  }
  return { counts, timeToPassport: duration("brief_started", "brief_completed"), timeToProposal: duration("brief_completed", "proposal_sent"),
    errorEvents: Object.fromEntries(launchErrorTypes.map((type) => [type, events.filter((event) => event.type === type).length])),
    invalidEvents, projectsWithoutLink: projects.size - cohort.length };
}

export function launchMetrics(events: readonly LaunchEvent[], calls: readonly LaunchAiCall[]) {
  const m1 = calls.filter((call) => ["brief", "risks", "proposal"].includes(call.module));
  let knownCostRub = 0;
  let missingCostCalls = 0;
  let unscopedCalls = 0;
  for (const call of m1) {
    if (!call.project_id) unscopedCalls++;
    const cost = call.cost_rub === null || call.cost_rub === "" ? NaN : Number(call.cost_rub);
    if (!Number.isSafeInteger(cost) || cost < 0) { missingCostCalls++; continue; }
    knownCostRub += cost;
    if (!Number.isSafeInteger(knownCostRub)) throw new Error("cost_sum_out_of_range");
  }
  return { activation: activationMetrics(events), ai: { calls: m1.length, failedCalls: m1.filter((c) => c.status === "error").length,
    knownCostRub, missingCostCalls, unscopedCalls, totalCostRub: m1.length && !missingCostCalls ? knownCostRub : null,
    status: m1.length && !missingCostCalls && !unscopedCalls ? "MEASURED_ROWS_ONLY" : "INCOMPLETE" },
    adoption: "BLOCKED_ON_OWNER", wedge: "paid_m1_m2_designer_cycle" };
}
