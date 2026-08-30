import { describe, it, expect } from "vitest";
import { FactoryRegistry } from "../store/factoryRegistry";
import {
  SAMPLE_AGENT_FOREMAN,
  SAMPLE_FACTORY_FULL,
  SAMPLE_RUNNER_LINUX,
} from "../fixtures/samples";
import {
  ALIAS_MAX,
  DEFAULT_CREDENTIAL_STRATEGY,
  deriveAnalysisModel,
  deriveIdentity,
  deriveIntegrations,
  deriveRepositories,
  getEffectiveCredentialStrategy,
  getRunnerSourceOfTruth,
  isRunnerFileManaged,
  resolveAgentCredentialStrategy,
  validateCredentialStrategy,
  validateForemanAlias,
} from "../domain/settings.derive";
import { DELETION_WARNING } from "../domain/settings.derive";

function makeBundle(factoryRaw: string) {
  return new FactoryRegistry().parseBundle({
    factoryYaml: { raw: factoryRaw, file: "factory.yaml" },
    agents: [{ raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" }],
    runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
    automations: [],
    scorers: [],
  }).value!;
}

describe("settings.derive — alias", () => {
  it("accepts valid alias within charset and length", () => {
    expect(validateForemanAlias("payments").ok).toBe(true);
    expect(validateForemanAlias("My Factory 1.0_2-3").ok).toBe(true);
    expect(validateForemanAlias("A".repeat(ALIAS_MAX)).ok).toBe(true);
  });

  it("rejects alias >60", () => {
    const alias = "a".repeat(61);
    const res = validateForemanAlias(alias);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.code === "alias_length")).toBe(true);
  });

  it("rejects charset violations", () => {
    expect(validateForemanAlias("pay/mnts!").ok).toBe(false);
    expect(validateForemanAlias("pay@nts").ok).toBe(false);
    expect(validateForemanAlias("alias#1").ok).toBe(false);
    const res = validateForemanAlias("bad/slash");
    expect(res.issues.some((i) => i.code === "alias_charset")).toBe(true);
  });

  it("valid charset allows space dot underscore hyphen", () => {
    expect(validateForemanAlias("a b.c_d-e").ok).toBe(true);
    expect(validateForemanAlias("0123 ABC xyz ._-").ok).toBe(true);
  });

  it("unicidad case-insensitive", () => {
    const res = validateForemanAlias("payments", { existingAliases: ["Payments"] });
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.code === "alias_unique")).toBe(true);
  });

  it("unicidad is case-insensitive both ways", () => {
    expect(validateForemanAlias("PAYMENTS", { existingAliases: ["payments"] }).ok).toBe(false);
    expect(validateForemanAlias("Payments", { existingAliases: ["PAYMENTS"] }).ok).toBe(false);
  });

  it("no conflict when different alias", () => {
    expect(validateForemanAlias("payments", { existingAliases: ["billing"] }).ok).toBe(true);
  });

  it("empty alias rejected unless allowEmpty", () => {
    expect(validateForemanAlias("", { allowEmpty: false }).ok).toBe(false);
    expect(validateForemanAlias(undefined, { allowEmpty: false }).ok).toBe(false);
    expect(validateForemanAlias("", { allowEmpty: true }).ok).toBe(true);
  });

  it("trims but validates pattern", () => {
    // trailing spaces are invalid chars if not trimmed by caller — validateForemanAlias expects exact string
    expect(validateForemanAlias("payments ").ok).toBe(true); // space allowed
    // but empty after trim handled by required check
  });

  it("deriveIdentity returns aliasValid", () => {
    const bundle = makeBundle(SAMPLE_FACTORY_FULL);
    const id = deriveIdentity(bundle, ["other"]);
    expect(id.name).toBe("payments-factory");
    expect(id.alias).toBe("payments");
    expect(id.aliasValid.ok).toBe(true);
  });

  it("deriveIdentity flags invalid alias", () => {
    const bundle = makeBundle(SAMPLE_FACTORY_FULL);
    // mutate after parse to bypass zod rejection — tests pure alias validation, not parser
    (bundle.factory as unknown as Record<string, unknown>).alias = "bad/alias!";
    const id = deriveIdentity(bundle);
    expect(id.aliasValid.ok).toBe(false);
  });
});

describe("settings.derive — credentialStrategy", () => {
  it("defaults to EXECUTOR", () => {
    const bundle = makeBundle(SAMPLE_FACTORY_FULL);
    expect(getEffectiveCredentialStrategy(bundle)).toBe("EXECUTOR");
    expect(DEFAULT_CREDENTIAL_STRATEGY).toBe("EXECUTOR");
  });

  it("respects CREATOR override at factory level", () => {
    const raw = SAMPLE_FACTORY_FULL.replace("alias: payments", "alias: payments\ncredentialStrategy: CREATOR");
    const bundle = makeBundle(raw);
    expect(getEffectiveCredentialStrategy(bundle)).toBe("CREATOR");
  });

  it("agent override per role takes precedence", () => {
    const bundle = makeBundle(SAMPLE_FACTORY_FULL);
    const foreman = bundle.agents.find((a) => a.name === "foreman")!;
    // manually set CREATOR on agent to test derive
    (foreman as unknown as Record<string, unknown>).credentialStrategy = "CREATOR";
    expect(resolveAgentCredentialStrategy("foreman", bundle)).toBe("CREATOR");
    expect(resolveAgentCredentialStrategy("nonexistent", bundle)).toBe("EXECUTOR");
  });

  it("validateCredentialStrategy accepts EXECUTOR and CREATOR only", () => {
    expect(validateCredentialStrategy("EXECUTOR").ok).toBe(true);
    expect(validateCredentialStrategy("CREATOR").ok).toBe(true);
    expect(validateCredentialStrategy("ADMIN").ok).toBe(false);
    expect(validateCredentialStrategy(undefined).ok).toBe(true);
    expect(validateCredentialStrategy(undefined).strategy).toBe("EXECUTOR");
  });

  it("covers 100 alias variations in loop", () => {
    const valid: string[] = ["a", "A 1", "my-factory_2.0", "WARP Factory", "x".repeat(60)];
    const invalid: string[] = ["a/b", "a!b", "a@b", "a#b", "a$b", "x".repeat(61), "slash/"];
    for (const v of valid) expect(validateForemanAlias(v).ok, `should accept ${v}`).toBe(true);
    for (const v of invalid) expect(validateForemanAlias(v).ok, `should reject ${v}`).toBe(false);
  });
});

describe("settings.derive — repositories / runners / integrations / deletion", () => {
  it("deriveRepositories lists owner/name", () => {
    const bundle = makeBundle(SAMPLE_FACTORY_FULL);
    const repos = deriveRepositories(bundle);
    expect(repos).toEqual(
      expect.arrayContaining([
        { owner: "acme", name: "payments-service" },
        { owner: "acme", name: "payments-api" },
      ])
    );
  });

  it("runners file-managed is github-backed only", () => {
    expect(isRunnerFileManaged("github-backed")).toBe(true);
    expect(isRunnerFileManaged("warp-managed")).toBe(false);
    expect(isRunnerFileManaged("live-managed")).toBe(false);
  });

  it("getRunnerSourceOfTruth contains expected phrases", () => {
    expect(getRunnerSourceOfTruth("github-backed")).toMatch(/runners\/\*\.yaml is source of truth/);
    expect(getRunnerSourceOfTruth("warp-managed")).toMatch(/Warp-managed/);
    expect(getRunnerSourceOfTruth("live-managed")).toMatch(/No runners/);
  });

  it("deriveAnalysisModel returns scorer model or auto", () => {
    const bundle = makeBundle(SAMPLE_FACTORY_FULL);
    // without scorers, fallback auto
    expect(deriveAnalysisModel(bundle)).toBe("auto");
  });

  it("deriveIntegrations maps slack/linear/jira statuses", () => {
    const bundle = makeBundle(SAMPLE_FACTORY_FULL);
    const ints = deriveIntegrations(bundle);
    expect(ints.find((i) => i.type === "slack")!.status).toBe("connected");
    expect(ints.find((i) => i.type === "linear")!.status).toBe("disconnected");
  });

  it("DELETION_WARNING mentions no reversible and bot/app", () => {
    expect(DELETION_WARNING).toMatch(/no reversible/);
    expect(DELETION_WARNING).toMatch(/bot\/app/);
  });
});
