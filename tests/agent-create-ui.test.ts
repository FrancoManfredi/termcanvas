/**
 * Alta de agentes en la UI (pura, sin DOM): validación del diálogo,
 * conversión a input del POST y mapeo draft ↔ frontmatter del editor.
 * Los componentes TSX no se renderizan acá (cero DOM).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_TOOL_OPTIONS,
  EMPTY_NEW_AGENT_FORM,
  newAgentFormToInput,
  validateNewAgentInput,
  type NewAgentForm,
} from "../src/features/warpPanel/agents/newAgentForm.ts";
import {
  draftFromAgentFull,
  draftToFrontmatter,
  formatModelShort,
  isAgentDraftDirty,
  normalizeToolsForUi,
} from "../src/features/warpPanel/agents/agentDraft.ts";
import type { AgentDraft } from "../src/features/warpPanel/types.ts";

function form(over: Partial<NewAgentForm> = {}): NewAgentForm {
  return { ...EMPTY_NEW_AGENT_FORM, tools: [...EMPTY_NEW_AGENT_FORM.tools], ...over };
}

test("vocabulario UI: tools reales de opencode, sin write legacy", () => {
  assert.deepEqual([...AGENT_TOOL_OPTIONS].sort(), [
    "bash",
    "edit",
    "glob",
    "grep",
    "list",
    "lsp",
    "read",
    "todowrite",
    "webfetch",
    "websearch",
  ]);
  assert.ok(!AGENT_TOOL_OPTIONS.includes("write"), "write no se ofrece (se pliega en edit)");
});

test("validate: vacío pide nombre+descripción+prompt", () => {
  const errors = validateNewAgentInput(form({ tools: [] }));
  assert.ok(errors.some((e) => e.includes("Name is required")));
  assert.ok(errors.some((e) => e.includes("Description is required")));
  assert.ok(errors.some((e) => e.includes("Prompt is required")));
  assert.ok(errors.some((e) => e.includes("at least one tool")));
});

test("validate: nombre con espacios/slash y model sin barra fallan", () => {
  const bad = validateNewAgentInput(
    form({ name: "mi agente", description: "d", body: "b", model: "sinbarra" }),
  );
  assert.ok(bad.some((e) => e.includes("Name must be")));
  assert.ok(bad.some((e) => e.includes("provider/model")));
  assert.deepEqual(
    validateNewAgentInput(form({ name: "playwright-tester", description: "d", body: "b" })),
    [],
    "form válido pasa limpio",
  );
});

test("validate: tools desconocidas fallan", () => {
  const bad = validateNewAgentInput(
    form({ name: "t", description: "d", body: "b", tools: ["read", "rayos-x"] }),
  );
  assert.ok(bad.some((e) => e.includes("Unknown tools")));
});

test("newAgentFormToInput: CUSTOM + primary + hooks neutralizados", () => {
  const input = newAgentFormToInput(form({ name: " tester ", description: "d", body: "b" }));
  assert.equal(input.name, "tester");
  assert.equal((input.frontmatter as Record<string, unknown>).agentType, "CUSTOM");
  assert.equal((input.frontmatter as Record<string, unknown>).mode, "primary");
  assert.equal((input.frontmatter as Record<string, unknown>).stage, "none");
  assert.equal((input.frontmatter as Record<string, unknown>).blocking, false);
  assert.deepEqual((input.frontmatter as Record<string, unknown>).skills, [], "sin skills");
  assert.deepEqual((input.frontmatter as Record<string, unknown>).mcps, [], "sin mcps");
  assert.ok(!("model" in (input.frontmatter as Record<string, unknown>)), "model vacío no viaja");
  const withModel = newAgentFormToInput(
    form({ name: "t", description: "d", body: "b", model: "opencode/big-pickle" }),
  );
  assert.equal((withModel.frontmatter as Record<string, unknown>).model, "opencode/big-pickle");
});

function draft(over: Partial<AgentDraft> = {}): AgentDraft {
  return {
    name: "triage",
    description: "d",
    agentType: "TRIAGE",
    model: "",
    icon: "",
    tools: ["read"],
    skills: [],
    mcps: [],
    prompt: "p",
    ...over,
  };
}

test("normalizeToolsForUi: write legacy se pliega en edit, desconocidas fuera", () => {
  assert.deepEqual(normalizeToolsForUi(["read", "write", "edit"]), ["read", "edit"]);
  assert.deepEqual(normalizeToolsForUi("{read,glob}"), ["read", "glob"]);
  assert.deepEqual(normalizeToolsForUi({ read: true, task: true }), ["read"], "task no entra");
  assert.deepEqual(normalizeToolsForUi(undefined), []);
});

test("draftFromAgentFull: normaliza frontmatter real (arrays, record y crudos)", () => {
  const parsed = draftFromAgentFull({
    name: "review",
    body: "Body real.",
    frontmatter: {
      description: "  Revisa.  ",
      agentType: "review",
      model: "opencode/big-pickle",
      icon: "shield",
      tools: { read: true, write: true, glob: true },
      skills: ["code-review", "repo-conventions"],
      mcps: "{github, fs}",
    },
  });
  assert.equal(parsed.description, "Revisa.");
  assert.equal(parsed.agentType, "REVIEW", "el tipo se preserva interno (oculto en UI)");
  assert.equal(parsed.icon, "shield");
  assert.deepEqual(parsed.tools.sort(), ["edit", "glob", "read"], "write se pliega en edit");
  assert.deepEqual(parsed.skills, ["code-review", "repo-conventions"]);
  assert.deepEqual(parsed.mcps, ["github", "fs"]);
  assert.equal(parsed.prompt, "Body real.");

  const junk = draftFromAgentFull({ name: "x", body: "b", frontmatter: { agentType: "NOPE" } } as never);
  assert.equal(junk.agentType, "CUSTOM", "tipo inválido cae a CUSTOM");
  assert.equal(junk.icon, "");
});

test("draftToFrontmatter: primary siempre, hooks neutralizados, icon viaja", () => {
  const fm = draftToFrontmatter(draft({ model: " p/m ", icon: "shield" }));
  assert.deepEqual(fm, {
    description: "d",
    agentType: "TRIAGE",
    mode: "primary",
    model: "p/m",
    icon: "shield",
    tools: ["read"],
    skills: [],
    mcps: [],
    stage: "none",
    blocking: false,
  });
});

test("isAgentDraftDirty: campos visibles, orden-insensible; junk = dirty", () => {
  assert.equal(isAgentDraftDirty(draft(), draft()), false);
  assert.equal(isAgentDraftDirty(draft(), draft({ tools: ["read", "bash"] })), true);
  assert.equal(
    isAgentDraftDirty(draft({ tools: ["read", "bash"] }), draft({ tools: ["bash", "read"] })),
    false,
    "orden no ensucia",
  );
  assert.equal(isAgentDraftDirty(draft(), draft({ skills: ["code-review"] })), true);
  assert.equal(isAgentDraftDirty(draft(), draft({ mcps: ["github"] })), true);
  assert.equal(isAgentDraftDirty(draft(), draft({ model: "x/y" })), true);
  assert.equal(isAgentDraftDirty(draft(), draft({ icon: "shield" })), true);
  assert.equal(isAgentDraftDirty(draft(), draft({ prompt: "otro" })), true);
  assert.equal(isAgentDraftDirty(draft(), draft({ description: "x" })), true);
  assert.equal(isAgentDraftDirty(draft(), null as unknown as AgentDraft), true);
  assert.equal(isAgentDraftDirty(null as unknown as AgentDraft, draft()), true);
});

test("formatModelShort: model id sin provider, default para vacío", () => {
  assert.equal(formatModelShort("opencode-go/muse-spark-1.3-contributor"), "muse-spark-1.3-contributor");
  assert.equal(formatModelShort("auto-disjoint"), "auto-disjoint");
  assert.equal(formatModelShort(""), "default");
});
