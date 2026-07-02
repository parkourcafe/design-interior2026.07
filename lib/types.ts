// Shared domain types. Mirrors the SQL schema in supabase/migrations and the
// shadow-passport structure documented in CLAUDE.md.

export type ProjectStatus =
  | "created"
  | "brief_sent"
  | "brief_in_progress"
  | "brief_completed"
  | "proposal_draft"
  | "proposal_sent";

export type RiskType = "budget" | "timeline" | "function" | "style" | "technical";
export type Confidence = "low" | "medium" | "high";
export type RiskStatus = "proposed" | "accepted" | "rejected";
export type RiskSource = "rule" | "llm";

export type ProposalStatus = "draft" | "sent";

export type EventType =
  | "intake_link_created"
  | "brief_started"
  | "brief_completed"
  | "proposal_created"
  | "proposal_sent";

// ── Money ────────────────────────────────────────────────
// Деньги — integer в рублях. Диапазоны как [min, max].
export type MoneyRange = [number, number];

// ── Shadow passport (projects.passport) ──────────────────
export type ObjectType = "flat" | "house" | "apartments";
export type AssetHorizon = "self_long" | "sell_2_5y" | "rent" | "unknown";
export type Load = "low" | "mid" | "high";
export type Cooking = "none" | "basic" | "heavy";
export type ScopePackage = "concept" | "full" | "full_plus_supervision" | null;

export interface Passport {
  object: { type: ObjectType | null; area_m2: number | null; city: string | null };
  asset_horizon: AssetHorizon;
  household: { now: string; in_5y: string; kids: boolean; pets: boolean };
  lifestyle: {
    morning_load: Load;
    bathrooms: number | null;
    cooking: Cooking;
    storage_pressure: Load;
  };
  budget: { range: MoneyRange | "undisclosed"; risk_level: Load };
  timeline: { target: string; urgency: "normal" | "urgent" };
  style: { refs: string[]; anti: string[]; notes: string };
  pain_points: string;
  scope: { package: ScopePackage };
}

// ── Risk card ────────────────────────────────────────────
export interface RiskCard {
  risk_type: RiskType;
  evidence: string[];
  impact: string;
  confidence: Confidence;
  designer_action: string;
  proposal_implication: string;
  source: RiskSource;
}

// ── Answers ──────────────────────────────────────────────
// value stored as jsonb — shape depends on question type.
export type AnswerValue =
  | string
  | number
  | string[]
  | { budget_range?: MoneyRange | "undisclosed" }
  | Record<string, unknown>;

export type AnswersMap = Record<string, AnswerValue>;

// ── Pricing ──────────────────────────────────────────────
export interface PricingConfig {
  base_rate_per_m2: number;
  multipliers: {
    complexity: { low: number; mid: number; high: number };
    urgency: number;
    package: { concept: number; full: number; full_plus_supervision: number };
  };
}

// ── Proposal ─────────────────────────────────────────────
export interface ProposalSection {
  id: string;
  title: string;
  body: string;
}

export interface ProposalDefaults {
  exclusions: string[];
  revision_limit: number;
  stage_completion: string;
}
