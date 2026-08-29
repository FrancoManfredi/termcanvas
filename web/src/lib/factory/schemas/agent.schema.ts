import { z } from "zod";
import { agentTypeSchema, credentialStrategySchema, harnessSchema, mcpServerRefSchema } from "./common.schema";


export const agentFrontmatterSchema = z
  .object({
    description: z.string().optional(),
    agentType: agentTypeSchema.optional().default("CUSTOM"),
    credentialStrategy: credentialStrategySchema.optional(),
    model: z.string().min(1).optional(),
    harness: harnessSchema.optional(),
    runner: z.string().min(1).optional(),
    environmentId: z.string().min(1).optional(),
    secrets: z.array(z.string().min(1)).optional(),
    mcpServers: z.record(z.string().min(1), mcpServerRefSchema).optional(),
    workerHost: z.string().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.model && val.harness) {
      ctx.addIssue({ code: "custom", message: "agent: set exactly one of model or harness", path: ["model"] });
      ctx.addIssue({ code: "custom", message: "agent: set exactly one of model or harness", path: ["harness"] });
    }
    // either is allowed to be missing (inherits from agentDefaults), so no required check here
  })
  .strict();

export type AgentFrontmatter = z.output<typeof agentFrontmatterSchema>;
