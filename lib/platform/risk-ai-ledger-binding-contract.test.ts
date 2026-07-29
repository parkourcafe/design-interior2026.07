import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260728013000_complete_m1_governed_runtime.sql",
  ),
  "utf8",
);

function sqlFunction(name: string): string {
  const matches = Array.from(
    migration.matchAll(
      new RegExp(
        `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`,
        "gi",
      ),
    ),
  );
  const start = matches.at(-1)?.index ?? -1;
  if (start < 0) return "";
  const tail = migration.slice(start);
  const marker = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
  if (!marker?.[1] || marker.index === undefined) return "";
  const end = tail.indexOf(marker[1], marker.index + marker[0].length);
  return end < 0 ? "" : tail.slice(0, end + marker[1].length);
}

describe("risk AI terminal commands are bound to the measured ledger", () => {
  it("restricts manual reruns to the still-pending human-review gate", () => {
    const reserve = sqlFunction("reserve_m1_risk_rerun");
    expect(reserve).not.toBe("");
    expect(reserve).toMatch(
      /\bw\.status\s*=\s*'waiting_for_human'[\s\S]*?\bw\.current_step\s*=\s*'human_review'/i,
    );
  });

  it("does not let usage recording switch the reserved provider identity", () => {
    const record = sqlFunction("record_m1_risk_ai_usage");
    expect(record).not.toBe("");
    expect(record).toMatch(
      /\bv_ai_call\.provider\s+is\s+distinct\s+from\s+(?:pg_catalog\.)?btrim\s*\(\s*p_provider\s*\)/i,
    );
    expect(record).toMatch(
      /\bv_ai_call\.model\s+is\s+distinct\s+from\s+(?:pg_catalog\.)?btrim\s*\(\s*p_model\s*\)/i,
    );
    expect(record).toMatch(/\ba\.request_digest\s+is\s+null/i);
    expect(record).toMatch(/\ba\.idempotency_key\s+is\s+null/i);
    expect(record).toMatch(
      /\bw\.status\s*=\s*'waiting_for_human'[\s\S]*?\bw\.current_step\s*=\s*'human_review'[\s\S]*?\bw\.status\s*=\s*'retrying'[\s\S]*?\bw\.current_step\s*=\s*'generate_risk_register'/i,
    );
  });

  it("rejects every duplicate finalize claim that differs from the completed ledger", () => {
    const finalize = sqlFunction("finalize_m1_risk_rerun");
    expect(finalize).not.toBe("");
    for (const binding of [
      ["provider", "p_provider"],
      ["model", "p_model"],
      ["tokens_in", "p_tokens_in"],
      ["tokens_out", "p_tokens_out"],
      ["duration_ms", "p_duration_ms"],
      ["provider_cost_estimate", "p_provider_cost_estimate"],
      ["estimate_source", "p_estimate_source"],
      ["outcome", "p_outcome"],
    ]) {
      expect(finalize).toMatch(
        new RegExp(
          `v_ai_call\\.${binding[0]}\\s+is\\s+distinct\\s+from[\\s\\S]{0,80}?${binding[1]}`,
          "i",
        ),
      );
    }
    expect(finalize).toMatch(/'risk_card_count'[\s\S]*?jsonb_array_length\s*\(\s*p_risk_cards\s*\)/i);
    expect(finalize).toMatch(/'llm_outcome'[\s\S]*?v_ai_call\.outcome/i);
    expect(finalize).toMatch(
      /'fallback_used'\s*,\s*v_ai_call\.outcome\s*<>\s*'success'/i,
    );
    expect(finalize).toMatch(/\ba\.request_digest\s+is\s+null/i);
    expect(finalize).toMatch(/\ba\.idempotency_key\s+is\s+null/i);
  });

  it("requires a completed close replay to match the same immutable usage", () => {
    const close = sqlFunction("close_m1_risk_ai_reservation");
    expect(close).not.toBe("");
    expect(close).toMatch(
      /\bv_ai_call\.lifecycle_state\s*=\s*'completed'[\s\S]*?\bnot\s+p_provider_completed[\s\S]*?\braise\s+exception\s+'completed AI usage is immutable'/i,
    );
    expect(close).toMatch(/\bv_ai_call\.outcome\s+is\s+distinct\s+from\s+p_outcome/i);
    expect(close).toMatch(/\ba\.request_digest\s+is\s+null/i);
    expect(close).toMatch(/\ba\.idempotency_key\s+is\s+null/i);
  });
});
