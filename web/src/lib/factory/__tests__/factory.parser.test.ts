import { describe, it, expect } from "vitest";
import { parseFactoryYaml } from "../parsers/factory.parser";

const minimalValid = `
schemaVersion: v1alpha1
name: payments-factory
repositories:
  - owner: acme
    name: payments-service
agentDefaults:
  model: auto
`;

describe("FactoryParser — parseFactoryYaml", () => {
  // 1-15 valid cases
  it("1. parses minimal valid factory", () => {
    const r = parseFactoryYaml(minimalValid);
    expect(r.ok).toBe(true);
    expect(r.value?.name).toBe("payments-factory");
  });
  it("2. parses with harness instead of model", () => {
    const yaml = minimalValid.replace("model: auto", "harness:\n    type: claude\n    model: claude-4-5-sonnet");
    const r = parseFactoryYaml(yaml);
    expect(r.ok).toBe(true);
    expect(r.value?.agentDefaults.harness?.type).toBe("claude");
  });
  it("3. parses alias with allowed chars", () => {
    const yaml = minimalValid + "alias: payments 1.0_test-OK\n";
    const r = parseFactoryYaml(yaml);
    expect(r.ok).toBe(true);
    expect(r.value?.alias).toBe("payments 1.0_test-OK");
  });
  it("4. parses alias max 60 chars", () => {
    const alias = "a".repeat(60);
    const yaml = minimalValid + `alias: ${alias}\n`;
    expect(parseFactoryYaml(yaml).ok).toBe(true);
  });
  it("5. parses multiple repositories", () => {
    const yaml = minimalValid.replace("    name: payments-service", "    name: payments-service\n  - owner: acme\n    name: api-service");
    expect(parseFactoryYaml(yaml).ok).toBe(true);
    expect(parseFactoryYaml(yaml).value?.repositories).toHaveLength(2);
  });
  it("6. parses description", () => {
    const yaml = minimalValid + "description: Processes payments\n";
    expect(parseFactoryYaml(yaml).ok).toBe(true);
  });
  it("7. parses credentialStrategy", () => {
    const yaml = minimalValid + "credentialStrategy: CREATOR\n";
    expect(parseFactoryYaml(yaml).ok).toBe(true);
  });
  it("8. parses slack integration", () => {
    const yaml = minimalValid + "integrations:\n  - type: slack\n";
    expect(parseFactoryYaml(yaml).ok).toBe(true);
  });
  it("9. parses linear integration", () => {
    const yaml = minimalValid + "integrations:\n  - type: linear\n";
    expect(parseFactoryYaml(yaml).ok).toBe(true);
  });
  it("10. parses mcpServers", () => {
    const yaml = minimalValid + "mcpServers:\n  sentry:\n    warpId: SENTRY_ID\n";
    expect(parseFactoryYaml(yaml).ok).toBe(true);
  });
  it("11. parses secrets", () => {
    const yaml = minimalValid + "secrets:\n  - SENTRY_TOKEN\n";
    expect(parseFactoryYaml(yaml).ok).toBe(true);
  });
  it("12. parses cloudProviders gcp", () => {
    const yaml = minimalValid + "cloudProviders:\n  gcp:\n    projectNumber: '1'\n    workloadIdentityFederationPoolId: pool\n    workloadIdentityFederationProviderId: prov\n";
    expect(parseFactoryYaml(yaml).ok).toBe(true);
  });
  it("13. parses cloudProviders aws", () => {
    const yaml = minimalValid + "cloudProviders:\n  aws:\n    roleArn: arn:aws:iam::123:role/x\n";
    expect(parseFactoryYaml(yaml).ok).toBe(true);
  });
  it("14. parses agentDefaults runner and workerHost", () => {
    const yaml = minimalValid.replace("model: auto", "model: auto\n  runner: linux-build\n  workerHost: warp");
    expect(parseFactoryYaml(yaml).ok).toBe(true);
  });
  it("15. parses oz harness without auth", () => {
    const yaml = minimalValid.replace("model: auto", "harness:\n    type: oz\n    model: auto");
    expect(parseFactoryYaml(yaml).ok).toBe(true);
  });

  // 16-35 invalid cases
  it("16. fails on missing schemaVersion", () => {
    const yaml = minimalValid.replace("schemaVersion: v1alpha1\n", "");
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
  it("17. fails on wrong schemaVersion", () => {
    const yaml = minimalValid.replace("v1alpha1", "v2");
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
  it("18. fails on missing name", () => {
    const yaml = minimalValid.replace("name: payments-factory\n", "");
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
  it("19. fails on empty repositories", () => {
    const yaml = `
schemaVersion: v1alpha1
name: x
repositories: []
agentDefaults:
  model: auto
`;
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
  it("20. fails on missing agentDefaults", () => {
    const yaml = minimalValid.replace(/agentDefaults:\n  model: auto\n/, "");
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
  it("21. fails when agentDefaults has both model and harness", () => {
    const yaml = minimalValid.replace("model: auto", "model: auto\n  harness:\n    type: oz\n    model: auto");
    const r = parseFactoryYaml(yaml);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("exactly one"))).toBe(true);
  });
  it("22. fails when agentDefaults has neither model nor harness", () => {
    const yaml = `
schemaVersion: v1alpha1
name: x
repositories:
  - owner: acme
    name: repo
agentDefaults:
  runner: linux-build
`;
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
  it("23. fails on alias 61 chars", () => {
    const alias = "a".repeat(61);
    const yaml = minimalValid + `alias: ${alias}\n`;
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
  it("24. fails on alias invalid char @", () => {
    const yaml = minimalValid + "alias: bad@alias\n";
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
  it("25. fails on alias invalid char /", () => {
    const yaml = minimalValid + "alias: bad/alias\n";
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
  it("26. fails on repository missing owner", () => {
    const yaml = minimalValid.replace("owner: acme", "");
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
  it("27. fails on repository missing name", () => {
    const yaml = minimalValid.replace("name: payments-service", "");
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
  it("28. fails on integration linear + jira mutually exclusive", () => {
    const yaml = minimalValid + "integrations:\n  - type: linear\n  - type: jira\n";
    const r = parseFactoryYaml(yaml);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("mutually exclusive"))).toBe(true);
  });
  it("29. fails on duplicate integration type", () => {
    const yaml = minimalValid + "integrations:\n  - type: slack\n  - type: slack\n";
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
  it("30. fails on unknown field strict", () => {
    const yaml = minimalValid + "unknownField: 123\n";
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
  it("31. fails on oz harness with auth", () => {
    const yaml = `
schemaVersion: v1alpha1
name: x
repositories:
  - owner: acme
    name: repo
agentDefaults:
  harness:
    type: oz
    model: auto
    auth:
      source: managedSecret
      secretName: KEY
`;
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
  it("32. fails on claude harness managedSecret missing secretName", () => {
    const yaml = `
schemaVersion: v1alpha1
name: x
repositories:
  - owner: acme
    name: repo
agentDefaults:
  harness:
    type: claude
    model: claude-4-opus
    auth:
      source: managedSecret
`;
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
  it("33. fails on mcpServers missing warpId", () => {
    const yaml = minimalValid + "mcpServers:\n  sentry: {}\n";
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
  it("34. fails on invalid YAML syntax", () => {
    const r = parseFactoryYaml("::: not yaml :::");
    expect(r.ok).toBe(false);
  });
  it("35. fails on empty input", () => {
    expect(parseFactoryYaml("").ok).toBe(false);
    expect(parseFactoryYaml("   ").ok).toBe(false);
  });
  it("36. fails on credentialStrategy invalid value", () => {
    const yaml = minimalValid + "credentialStrategy: INVALID\n";
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
});
