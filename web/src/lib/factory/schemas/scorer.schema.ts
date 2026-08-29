import { z } from "zod";


const labelSchema = z.object({
  value: z.string().min(1),
  score: z.number().min(0).max(1),
  description: z.string().optional(),
});

export const scorerFrontmatterSchema = z
  .object({
    name: z.string().min(1, "scorer name required"),
    description: z.string().optional(),
    agents: z.array(z.string().min(1)).min(1, "at least one agent required"),
    output: z.enum(["classification"]).optional().default("classification"),
    labels: z.array(labelSchema).min(1, "at least one label required"),
    passingScore: z.number().min(0).max(1),
    samplingRate: z.number().min(0).max(100).optional().default(25),
    model: z.string().min(1, "model required"),
    selfImprovement: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasPassing = val.labels.some((l) => l.score >= val.passingScore);
    const hasFailing = val.labels.some((l) => l.score < val.passingScore);
    if (!hasPassing) {
      ctx.addIssue({ code: "custom", message: "at least one label must have score >= passingScore", path: ["labels"] });
    }
    if (!hasFailing) {
      ctx.addIssue({ code: "custom", message: "at least one label must have score < passingScore", path: ["labels"] });
    }
    const values = val.labels.map((l) => l.value);
    if (new Set(values).size !== values.length) {
      ctx.addIssue({ code: "custom", message: "label values must be unique", path: ["labels"] });
    }
  });

export type ScorerFrontmatter = z.output<typeof scorerFrontmatterSchema>;
