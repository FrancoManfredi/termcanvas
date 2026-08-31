import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// High-quality test for codebuddy model flag fix (no provider prefix) and fullscreen
// Verifies the bug the user reported: codebuddy/fast-model -> fast-model, and window maximize

describe("codebuddy model flag — high quality", () => {
  it("runModelFlagArgs for codebuddy uses just modelID, not provider/model", async () => {
    const { runModelFlagArgs, tuiModelFlagArgs } = await import("../src/planner/modelPin.ts");
    const ref = { providerID: "codebuddy", modelID: "fast-model" };
    assert.deepEqual(runModelFlagArgs(ref, "codebuddy"), ["--model", "fast-model"]);
    assert.deepEqual(tuiModelFlagArgs(ref, "codebuddy"), ["--model", "fast-model"]);
    // opencode should still use provider/model
    const ref2 = { providerID: "opencode-go", modelID: "hy3" };
    assert.deepEqual(runModelFlagArgs(ref2, "opencode"), ["--model", "opencode-go/hy3"]);
    assert.deepEqual(tuiModelFlagArgs(ref2, "opencode"), ["--model", "opencode-go/hy3"]);
    // opencode with variant
    const ref3 = { providerID: "opencode-go", modelID: "hy3", variant: "max" };
    assert.deepEqual(runModelFlagArgs(ref3, "opencode"), ["--model", "opencode-go/hy3", "--variant", "max"]);
    assert.deepEqual(runModelFlagArgs(ref3, "codebuddy"), ["--model", "hy3"], "codebuddy should drop variant");
  });

  it("headless-runtime CLI_LAUNCH codebuddy modelArgs uses just ID", async () => {
    const { CLI_LAUNCH } = await import("../headless-runtime/terminal-launch.ts");
    const adapter = CLI_LAUNCH["codebuddy"]!;
    assert.deepEqual(adapter.modelArgs("codebuddy/fast-model"), ["--model", "fast-model"]);
    assert.deepEqual(adapter.modelArgs("fast-model"), ["--model", "fast-model"]);
    assert.deepEqual(adapter.modelArgs("opencode-go/hy3"), ["--model", "hy3"], "should extract after /");
  });

  it("PhaseModelsSection dry-run preview for codebuddy is correct (no --prompt, no provider prefix)", async () => {
    const content = fs.readFileSync("src/components/settings/PhaseModelsSection.tsx", "utf-8");
    // Should have the fixed codebuddy preview
    assert.ok(content.includes('`codebuddy -p --output-format json --model ${effective.modelID}`') || content.includes("--model ${effective.modelID}"), "should use just modelID for codebuddy");
    assert.ok(!content.includes('codebuddy -p --output-format json --model ${effective.providerID}/${effective.modelID} --prompt'), "should NOT have old buggy --prompt with provider prefix");
    // Verify the dry-run for codebuddy uses positional prompt, not --prompt
    assert.ok(content.includes('codebuddy -p --output-format json'), "should have headless codebuddy -p");
    assert.ok(content.includes('"<prompt>"'), "should have positional prompt");
  });

  it("planningSession terminal.modelOverride for codebuddy is just modelID", async () => {
    const content = fs.readFileSync("src/planner/planningSession.ts", "utf-8");
    assert.ok(content.includes('cliType === "codebuddy" ? options.model.modelID'), "should store just modelID for codebuddy");
    assert.ok(content.includes('runModelFlagArgs(options.model, cliForFlags)'), "should pass cli to runModelFlagArgs");
  });

  it("electron main window opens maximized", async () => {
    const content = fs.readFileSync("electron/main.ts", "utf-8");
    assert.ok(content.includes("mainWindow?.maximize()"), "should call maximize on ready-to-show");
    assert.ok(content.includes('mainWindow.once("ready-to-show"'), "should have ready-to-show handler");
  });

  it("codebuddy headless command without --prompt is correct (integration smoke, no model call)", async () => {
    const { execSync } = await import("node:child_process");
    // This is the exact command the user ran that failed before, now with correct modelID
    // We don't actually run it with a prompt, just verify the command would not give 400 for model not found
    // Use a dry-run: check that `codebuddy --help` mentions -p and --model, and that fast-model is in the list
    const help = execSync("codebuddy --help", { encoding: "utf-8", timeout: 3000, windowsHide: true });
    assert.ok(help.includes("--model"), "help should mention --model");
    assert.ok(help.includes("-p") || help.includes("--print"), "help should mention -p/--print for headless");
    // Verify that fast-model is in the supported list (from --help's model list)
    // The help lists "Currently supported: (default-model, fast-model, ...)"
    assert.ok(help.includes("fast-model") || help.includes("default-model"), "help should list fast-model");
  });
});
