import type { AnswersMap } from "@/lib/types";

export interface ExtractedFact {
  fact_type: "requirement" | "constraint" | "assumption" | "open_question";
  value: unknown;
  evidence_locator: string;
  status: "extracted" | "unknown";
  confidence: number | null;
  created_by_type: "system";
}

const CONSTRAINT_IDS = new Set(["budget", "timeline", "object"]);

export function normalizeBriefFacts(answers: AnswersMap): ExtractedFact[] {
  return Object.entries(answers).map(([questionId, value]) => ({
    fact_type: CONSTRAINT_IDS.has(questionId) ? "constraint" : "requirement",
    value: { question_id: questionId, answer: value },
    evidence_locator: `answers.${questionId}`,
    status: value === "" || value == null ? "unknown" : "extracted",
    confidence: value === "" || value == null ? null : 1,
    created_by_type: "system",
  }));
}

