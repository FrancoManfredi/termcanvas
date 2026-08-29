import { z } from "zod";
import {
  credentialStrategySchema,
  harnessSchema,
  harnessTypeSchema,
  mcpServerRefSchema,
  ownerNameSchema,
} from "./common.schema";



// SRP: only factory.yaml shape — no parsing, no I/O

const aliasSchema = z
  .string()
  .max(60, "alias max 60 chars")
  .regex(/^[A-Za-z0-9 ._-]+$/, "alias: allowed [A-Za-z0-9 ._-]")
  .optional();

const repositorySchema = z.object({
  owner: ownerNameSchema,
  name: z.string().min(1, "repository name required").regex(/^[A-Za-z0-9_.-]+$/, "repo name: allowed [A-Za-z0-9._-]"),
});

const cloudProvidersSchema = z
  .object({
    gcp: z
      .object({
        projectNumber: z.string().min(1),
        workloadIdentityFederationPoolId: z.string().min(1),
        workloadIdentityFederationProviderId: z.string().min(1),
        serviceAccountEmail: z.string().email().optional(),
      })
      .optional(),
    aws: z.object({ roleArn: z.string().min(1) }).optional(),
  })
  .optional();

const integrationSchema = z.object({
  type: z.enum(["slack", "linear", "jira"]),
});

const agentDefaultsSchema = z
  .object({
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
      ctx.addIssue({ code: "custom", message: "agentDefaults: set exactly one of model or harness", path: ["model"] });
      ctx.addIssue({ code: "custom", message: "agentDefaults: set exactly one of model or harness", path: ["harness"] });
    }
    if (!val.model && !val.harness) {
      // Warp doc says declare exactly one of model or harness
      ctx.addIssue({ code: "custom", message: "agentDefaults: requires exactly one of model or harness", path: ["model"] });
    }
    // harness type oz must not have auth already validated inside harnessSchema
    if (val.harness && val.harness.type === "oz" && "auth" in val.harness && val.harness.auth) {
      // already handled, but keep for safety
    }
    void harnessTypeSchema;
  });

export const factoryYamlSchema = z
  .object({
    schemaVersion: z.literal("v1alpha1", { message: "schemaVersion must be v1alpha1" }),
    name: z.string().min(1, "name required"),
    description: z.string().optional(),
    alias: aliasSchema,
    credentialStrategy: credentialStrategySchema.optional(),
    repositories: z.array(repositorySchema).min(1, "at least one repository required"),
    secrets: z.array(z.string().min(1)).optional(),
    mcpServers: z.record(z.string().min(1), mcpServerRefSchema).optional(),
    cloudProviders: cloudProvidersSchema,
    integrations: z
      .array(integrationSchema)
      .optional()
      .superRefine((vals, ctx) => {
        if (!vals) return;
        const types = vals.map((v) => v.type);
        const hasLinear = types.includes("linear");
        const hasJira = types.includes("jira");
        if (hasLinear && hasJira) {
          ctx.addIssue({ code: "custom", message: "integrations: linear and jira are mutually exclusive", path: [] });
        }
        // uniqueness of type
        const seen = new Set<string>();
        for (let i = 0; i < types.length; i++) {
          if (seen.has(types[i])) {
            ctx.addIssue({ code: "custom", message: `duplicate integration type '${types[i]}'`, path: [i.toString()] });
          }
          seen.add(types[i]);
        }
      }),
    agentDefaults: agentDefaultsSchema,
  })
  .strict();

export type FactoryYamlInput = z.input<typeof factoryYamlSchema>;
export type FactoryYamlValidated = z.output<typeof factoryYamlSchema>;
