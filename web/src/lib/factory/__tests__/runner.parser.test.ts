import { describe, it, expect } from "vitest";
import { parseRunnerYaml } from "../parsers/runner.parser";

describe("RunnerParser — parseRunnerYaml", () => {
  it("1. parses minimal empty runner (defaults to linux check fails without dockerImage?) fallback", () => {
    // empty should fail because linux requires dockerImage, so provide minimal valid
    const raw = `
platform:
  os: linux
  arch: x86_64
  linux:
    dockerImage: ubuntu:22.04
`;
    expect(parseRunnerYaml(raw, "runners/linux-build.yaml").ok).toBe(true);
  });
  it("2. parses linux runner full", () => {
    const raw = `
description: Linux runner
setupCommands:
  - corepack enable
instanceShape:
  vcpus: 4
  memoryGb: 8
platform:
  os: linux
  arch: x86_64
  linux:
    dockerImage: ubuntu:22.04
`;
    const r = parseRunnerYaml(raw, "runners/linux-build.yaml");
    expect(r.ok).toBe(true);
    expect(r.value?.name).toBe("linux-build");
    expect(r.value?.instanceShape?.vcpus).toBe(4);
  });
  it("3. parses macos runner", () => {
    const raw = `
platform:
  os: macos
  arch: aarch64
  mac:
    version: "26"
`;
    expect(parseRunnerYaml(raw, "runners/mac.yaml").ok).toBe(true);
  });
  it("4. parses macos version 14", () => {
    const raw = `platform:\n  os: macos\n  arch: aarch64\n  mac:\n    version: "14"\n`;
    expect(parseRunnerYaml(raw, "runners/mac.yaml").ok).toBe(true);
  });
  it("5. parses macos version 15", () => {
    const raw = `platform:\n  os: macos\n  arch: aarch64\n  mac:\n    version: "15"\n`;
    expect(parseRunnerYaml(raw, "runners/mac.yaml").ok).toBe(true);
  });
  it("6. parses with description and setupCommands", () => {
    const raw = `description: test\nsetupCommands:\n  - echo hi\nplatform:\n  os: linux\n  arch: x86_64\n  linux:\n    dockerImage: node:20\n`;
    expect(parseRunnerYaml(raw, "runners/x.yaml").ok).toBe(true);
  });
  it("7. fails on empty input", () => {
    expect(parseRunnerYaml("", "runners/x.yaml").ok).toBe(false);
  });
  it("8. fails on linux missing dockerImage", () => {
    const raw = `platform:\n  os: linux\n  arch: x86_64\n`;
    const r = parseRunnerYaml(raw, "runners/bad.yaml");
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("dockerImage"))).toBe(true);
  });
  it("9. fails on macos with x86_64", () => {
    const raw = `platform:\n  os: macos\n  arch: x86_64\n`;
    expect(parseRunnerYaml(raw, "runners/bad.yaml").ok).toBe(false);
  });
  it("10. fails on macos with linux field", () => {
    const raw = `platform:\n  os: macos\n  arch: aarch64\n  linux:\n    dockerImage: ubuntu:22.04\n`;
    expect(parseRunnerYaml(raw, "runners/bad.yaml").ok).toBe(false);
  });
  it("11. fails on linux with mac field", () => {
    const raw = `platform:\n  os: linux\n  arch: x86_64\n  linux:\n    dockerImage: ubuntu:22.04\n  mac:\n    version: "26"\n`;
    expect(parseRunnerYaml(raw, "runners/bad.yaml").ok).toBe(false);
  });
  it("12. fails on instanceShape negative vcpus", () => {
    const raw = `instanceShape:\n  vcpus: -1\n  memoryGb: 8\nplatform:\n  os: linux\n  arch: x86_64\n  linux:\n    dockerImage: ubuntu:22.04\n`;
    expect(parseRunnerYaml(raw, "runners/bad.yaml").ok).toBe(false);
  });
  it("13. fails on instanceShape zero memory", () => {
    const raw = `instanceShape:\n  vcpus: 2\n  memoryGb: 0\nplatform:\n  os: linux\n  arch: x86_64\n  linux:\n    dockerImage: ubuntu:22.04\n`;
    expect(parseRunnerYaml(raw, "runners/bad.yaml").ok).toBe(false);
  });
  it("14. fails on invalid YAML", () => {
    expect(parseRunnerYaml("::: bad", "runners/bad.yaml").ok).toBe(false);
  });
  it("15. fails on unknown field strict", () => {
    const raw = `unknown: 123\nplatform:\n  os: linux\n  arch: x86_64\n  linux:\n    dockerImage: ubuntu:22.04\n`;
    expect(parseRunnerYaml(raw, "runners/bad.yaml").ok).toBe(false);
  });
  it("16. parses yml extension name extraction", () => {
    const raw = `platform:\n  os: linux\n  arch: x86_64\n  linux:\n    dockerImage: ubuntu:22.04\n`;
    const r = parseRunnerYaml(raw, "runners/my-runner.yml");
    expect(r.ok).toBe(true);
    expect(r.value?.name).toBe("my-runner");
  });
  it("17. parses without platform (should fail due to dockerImage required?) but schema allows omit? it requires linux check defaults to linux", () => {
    const raw = `description: no platform\n`;
    const r = parseRunnerYaml(raw, "runners/bad.yaml");
    // without platform -> os defaults to linux but no dockerImage -> should fail
    expect(r.ok).toBe(false);
  });
  it("18. parses instanceShape only vcpus missing memoryGb fails", () => {
    const raw = `instanceShape:\n  vcpus: 2\nplatform:\n  os: linux\n  arch: x86_64\n  linux:\n    dockerImage: ubuntu:22.04\n`;
    expect(parseRunnerYaml(raw, "runners/bad.yaml").ok).toBe(false);
  });
  it("19. parses valid with large shape", () => {
    const raw = `instanceShape:\n  vcpus: 16\n  memoryGb: 64\nplatform:\n  os: linux\n  arch: x86_64\n  linux:\n    dockerImage: ubuntu:22.04\n`;
    expect(parseRunnerYaml(raw, "runners/big.yaml").ok).toBe(true);
  });
  it("20. handles empty yaml null", () => {
    expect(parseRunnerYaml("null\n", "runners/bad.yaml").ok).toBe(false);
  });
});
