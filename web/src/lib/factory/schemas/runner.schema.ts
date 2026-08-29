import { z } from "zod";


export const runnerYamlSchema = z
  .object({
    description: z.string().optional(),
    setupCommands: z.array(z.string()).optional(),
    instanceShape: z
      .object({
        vcpus: z.number().int().positive(),
        memoryGb: z.number().positive(),
      })
      .optional(),
    platform: z
      .object({
        os: z.enum(["linux", "macos"]).default("linux"),
        arch: z.enum(["x86_64", "aarch64"]).default("x86_64"),
        linux: z.object({ dockerImage: z.string().min(1) }).optional(),
        mac: z
          .object({
            version: z.enum(["14", "15", "26", "27"]).optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const os = val.platform?.os ?? "linux";
    const arch = val.platform?.arch ?? "x86_64";
    if (os === "linux" && !val.platform?.linux?.dockerImage) {
      // Warp doc: Linux runners require linux.dockerImage
      ctx.addIssue({ code: "custom", message: "platform.linux.dockerImage required when os is linux", path: ["platform", "linux", "dockerImage"] });
    }
    if (os === "macos" && arch !== "aarch64") {
      ctx.addIssue({ code: "custom", message: "macOS runners must be aarch64", path: ["platform", "arch"] });
    }
    if (os === "macos" && val.platform?.linux) {
      ctx.addIssue({ code: "custom", message: "macOS runner must not have platform.linux", path: ["platform", "linux"] });
    }
    if (os === "linux" && val.platform?.mac) {
      ctx.addIssue({ code: "custom", message: "linux runner must not have platform.mac", path: ["platform", "mac"] });
    }
  });

export type RunnerYamlValidated = z.output<typeof runnerYamlSchema>;
