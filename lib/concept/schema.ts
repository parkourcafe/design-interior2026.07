import { z } from "zod";

export const conceptPackageSchema = z.enum([
  "concept",
  "full",
  "full_plus_supervision",
]);

export const conceptPackSectionSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum([
      "summary",
      "style",
      "moodboard",
      "palette",
      "room",
      "designer_notes",
      "client_summary",
    ]),
    title: z.string().min(1),
    body: z.string().min(1),
    bullets: z.array(z.string().min(1)),
  })
  .strict();

export const conceptPackSchema = z.object({
  version: z.literal(1),
  status: z.literal("ready"),
  source: z
    .object({
      package: conceptPackageSchema,
      answer_count: z.number().int().nonnegative(),
      accepted_risk_count: z.number().int().nonnegative(),
      proposal_present: z.boolean(),
    })
    .strict(),
  project_summary: z.string().min(1),
  style_direction: z
    .object({
      title: z.string().min(1),
      rationale: z.string().min(1),
      principles: z.array(z.string().min(1)).min(1),
      avoid: z.array(z.string().min(1)).min(1),
    })
    .strict(),
  moodboard_outline: z
    .object({
      direction: z.string().min(1),
      frames: z
        .array(
          z
            .object({
              id: z.string().min(1),
              title: z.string().min(1),
              brief: z.string().min(1),
              search_prompts: z.array(z.string().min(1)).min(1),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
  palette_direction: z
    .object({
      base: z.array(z.string().min(1)).min(1),
      accents: z.array(z.string().min(1)).min(1),
      materials: z.array(z.string().min(1)).min(1),
      note: z.string().min(1),
    })
    .strict(),
  room_directions: z
    .array(
      z
        .object({
          id: z.string().min(1),
          zone: z.string().min(1),
          concept: z.string().min(1),
          priorities: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    )
    .min(1),
  designer_notes: z.array(z.string().min(1)).min(1),
  client_ready_summary: z.string().min(1),
  concept_sections: z.array(conceptPackSectionSchema).min(1),
}).strict();

export type ConceptPackage = z.infer<typeof conceptPackageSchema>;
export type ConceptPackSection = z.infer<typeof conceptPackSectionSchema>;
export type ConceptPack = z.infer<typeof conceptPackSchema>;
