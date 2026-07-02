import { z } from "zod";

// Строгая схема карточки риска для валидации LLM-ответа (Zod safeParse).
// Дублируется человекочитаемо в тексте промпта (см. llm.ts).
export const RiskCardLlmSchema = z.object({
  risk_type: z.enum(["budget", "timeline", "function", "style", "technical"]),
  evidence: z.array(z.string()).min(1),
  impact: z.string().min(1),
  confidence: z.enum(["low", "medium", "high"]),
  designer_action: z.string().min(1),
  proposal_implication: z.string().min(1),
});

export const RiskCardsLlmSchema = z.array(RiskCardLlmSchema).max(8);

export type RiskCardLlm = z.infer<typeof RiskCardLlmSchema>;
