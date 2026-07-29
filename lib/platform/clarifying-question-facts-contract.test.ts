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
  const start = migration.search(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`,
      "i",
    ),
  );
  if (start < 0) return "";

  const tail = migration.slice(start);
  const marker = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
  if (!marker?.[1] || marker.index === undefined) return "";
  const end = tail.indexOf(marker[1], marker.index + marker[0].length);
  return end < 0 ? "" : tail.slice(0, end + marker[1].length);
}

describe("clarifying-question ProjectFact persistence", () => {
  const command = sqlFunction("persist_m1_proposal_draft_steps");

  it("locks and deterministically digests the exact accepted risk questions", () => {
    expect(command).not.toBe("");
    expect(command).toMatch(
      /\bif\s+exists\s*\([\s\S]*?\bfrom\s+public\.risk_cards\b[\s\S]*?\bstatus\s*=\s*'accepted'[\s\S]*?\blength\s*\(\s*pg_catalog\.btrim\s*\(\s*[\s\S]*?designer_action\s*\)\s*\)\s*>\s*4000[\s\S]*?\)\s*then[\s\S]*?\braise\s+exception\b/i,
    );
    expect(command).toMatch(
      /\bfrom\s+public\.risk_cards\s+(?:as\s+)?[a-z_][a-z0-9_$]*[\s\S]*?\bproject_id\s*=\s*p_project_id[\s\S]*?\bstatus\s*=\s*'accepted'[\s\S]*?\bdesigner_action\s*!~\s*'\^\[\[:space:\]\]\*\$'[\s\S]*?\border\s+by\s+[\s\S]*?\bfor\s+update\b/i,
    );
    expect(command).toMatch(
      /\bstring_agg\s*\([\s\S]*?\bdesigner_action\b[\s\S]*?\border\s+by\s+[\s\S]*?\bid\b[\s\S]*?\bdigest\s*\([\s\S]*?'sha256'/i,
    );
  });

  it("creates a digest-bound designer-input source for the question set", () => {
    const sourceInsert =
      /\binsert\s+into\s+public\.project_sources\s*\(([\s\S]*?)\)\s*values\s*\(([\s\S]*?)\)\s*on\s+conflict[\s\S]*?\breturning\s+id\s+into\s+([a-z_][a-z0-9_$]*)/i.exec(
        command,
      );

    expect(sourceInsert, "the question set needs a durable source").not.toBeNull();
    if (!sourceInsert) throw new Error("question source insert is missing");

    expect(sourceInsert[1]).toMatch(/\bproject_id\b/i);
    expect(sourceInsert[1]).toMatch(/\bsource_type\b/i);
    expect(sourceInsert[1]).toMatch(/\bsource_ref\b/i);
    expect(sourceInsert[1]).toMatch(/\bchecksum\b/i);
    expect(sourceInsert[1]).toMatch(/\bcreated_by\b/i);
    expect(sourceInsert[2]).toMatch(/'designer_input'/i);
    expect(sourceInsert[2]).toMatch(/\bv_run\.id\b/i);
    expect(sourceInsert[2]).toMatch(/\bv_proposal\.id\b/i);
    expect(sourceInsert[2]).toMatch(/\bv_content_digest\b/i);
    expect(sourceInsert[2]).toMatch(/\bv_question_digest\b/i);
    expect(sourceInsert[2]).toMatch(/\bv_actor\b/i);
  });

  it("appends one attributable open_question fact per persisted question", () => {
    const factInsert =
      /\binsert\s+into\s+public\.project_facts\s*\(([\s\S]*?)\)\s*values\s*\(([\s\S]*?)\)\s*returning\s+id\s+into\s+([a-z_][a-z0-9_$]*)/i.exec(
        command,
      );

    expect(factInsert, "clarifying questions must be ProjectFacts").not.toBeNull();
    if (!factInsert) throw new Error("question fact insert is missing");

    for (const column of [
      "project_id",
      "fact_type",
      "value",
      "source_id",
      "evidence_locator",
      "status",
      "confidence",
      "created_by_type",
      "created_by_id",
      "version",
      "supersedes_id",
    ]) {
      expect(factInsert[1], `${column} must be persisted`).toMatch(
        new RegExp(`\\b${column}\\b`, "i"),
      );
    }
    expect(factInsert[2]).toMatch(/'open_question'/i);
    expect(factInsert[2]).toMatch(/\bv_question_value\b/i);
    expect(factInsert[2]).toMatch(/\bv_question_source_id\b/i);
    expect(factInsert[2]).toMatch(/\bv_question_locator\b/i);
    expect(factInsert[2]).toMatch(/'interpreted'/i);
    expect(factInsert[2]).toMatch(/\b1(?:\.0+)?\b/i);
    expect(factInsert[2]).toMatch(/'(?:system|human)'/i);
    expect(factInsert[2]).toMatch(
      /\bcoalesce\s*\(\s*v_previous_question_version\s*,\s*0\s*\)\s*\+\s*1\b/i,
    );
    expect(factInsert[2]).toMatch(/\bv_previous_question_id\b/i);

    expect(command).toMatch(
      /\bv_question_locator\s*:=\s*'risk_cards\.'\s*\|\|\s*[a-z_][a-z0-9_$]*\.id::text\s*\|\|\s*'\.designer_action'/i,
    );
    expect(command).toMatch(
      /\bv_question_value\s*:=\s*pg_catalog\.jsonb_build_object\s*\([\s\S]*?'risk_card_id'[\s\S]*?'question'[\s\S]*?'workflow_run_id'[\s\S]*?'proposal_id'[\s\S]*?'content_digest'[\s\S]*?'question_digest'/i,
    );
    expect(command).not.toMatch(
      /\b(?:update|delete\s+from)\s+public\.project_facts\b/i,
    );
  });

  it("locks the latest lineage head and appends an exact successor", () => {
    expect(command).toMatch(
      /\bselect\s+[\s\S]*?\.id\s*,\s*[\s\S]*?\.version\s+into\s+v_previous_question_id\s*,\s*v_previous_question_version[\s\S]*?\bfrom\s+public\.project_facts\b[\s\S]*?\bproject_id\s*=\s*p_project_id[\s\S]*?\bevidence_locator\s*=\s*v_question_locator[\s\S]*?\border\s+by\s+[\s\S]*?\.version\s+desc[\s\S]*?\blimit\s+1[\s\S]*?\bfor\s+update\b/i,
    );
  });

  it("makes exact question-set replay idempotent and changed questions versioned", () => {
    const earlyReplay = command.search(
      /\bv_progress_complete[\s\S]{0,180}?\breturn\s+v_run\.id\b/i,
    );
    const firstFactInsert = command.search(
      /\binsert\s+into\s+public\.project_facts\b/i,
    );

    expect(earlyReplay).toBeGreaterThanOrEqual(0);
    expect(firstFactInsert).toBeGreaterThan(earlyReplay);
    expect(command).toMatch(
      /\bcompleted_step\.output_snapshot\s*->>\s*'question_digest'\s*=\s*v_question_digest\b/i,
    );
    expect(command).toMatch(
      /\bwhen\s+'generate_clarifying_questions'\s+then[\s\S]*?'question_digest'\s*,\s*v_question_digest/i,
    );
    expect(command).toMatch(
      /\bif\s+v_persisted_question_count\s*<>\s*v_question_count\s+then[\s\S]*?\braise\s+exception\b/i,
    );
    expect(command).toMatch(
      /'question_count'\s*,\s*v_persisted_question_count/i,
    );
  });

  it("writes action-specific append-only audit evidence for every new question fact", () => {
    const audit =
      /\binsert\s+into\s+public\.audit_events\s*\(([\s\S]*?)\)\s*values\s*\(([\s\S]*?'clarifying_question_persisted'[\s\S]*?)\)\s*;/i.exec(
        command,
      );

    expect(audit, "each new question fact needs its own audit event").not.toBeNull();
    if (!audit) throw new Error("question audit insert is missing");

    expect(audit[2]).toMatch(/'project_fact'/i);
    expect(audit[2]).toMatch(/\bv_question_fact_id\b/i);
    expect(audit[2]).toMatch(/\bv_run\.id\b/i);
    expect(audit[2]).toMatch(/'risk_card_id'/i);
    expect(audit[2]).toMatch(/'proposal_id'/i);
    expect(audit[2]).toMatch(/'content_digest'/i);
    expect(audit[2]).toMatch(/'question_digest'/i);
    expect(audit[2]).toMatch(/'evidence_locator'/i);
    expect(audit[2]).toMatch(/'version'/i);
    expect(audit[2]).toMatch(/'supersedes_id'/i);
  });
});
