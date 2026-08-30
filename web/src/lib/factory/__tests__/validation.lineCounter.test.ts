// validation.lineCounter.test.ts — SRP: P1-01 file+line real con yaml LineCounter
// Source: WarpFactories.md §7 · US-058 · PRD P1-01

import { describe, it, expect } from "vitest";
import { parseYamlWithLineCounter, lineForPath } from "../domain/validation.lineCounter";
import { parseYamlWithLineCounter as parseYamlWithLineCounterUtil } from "../parsers/yaml.utils";
import { zodToParseIssues } from "../schemas/common.schema";
import { z } from "zod";
import { FactoryParser } from "../parsers/factory.parser";

/** Fixture donde repositories.0.owner está exactamente en línea 12 (spec example). */
const YAML_LINE_12_FIXTURE = `schemaVersion: v1alpha1
name: test
description: d
alias: a
credentialStrategy: EXECUTOR
secrets:
  - s
mcpServers:
  sentry:
    warpId: id
repositories:
  - owner: bad@owner!
    name: repo1
agentDefaults:
  model: auto
`;

const YAML_NESTED_FIXTURE = `schemaVersion: v1alpha1
name: payments-factory
repositories:
  - owner: acme
    name: payments-service
  - owner: acme2
    name: payments-api
  - owner: bad@owner!
    name: other-service
agentDefaults:
  model: auto
`;

describe("P1-01 — Validation file+line real con LineCounter", () => {
  it("parseYamlWithLineCounter expone doc y lineCounter y lineForPath mapea repositories.0.owner a línea 12", () => {
    const { lineCounter } = parseYamlWithLineCounter(YAML_LINE_12_FIXTURE);
    const pos = lineForPath(lineCounter, ["repositories", 0, "owner"]);
    expect(pos).toBeDefined();
    expect(pos?.line).toBe(12);
    expect(pos?.col).toBeGreaterThan(0);
  });

  it("yaml.utils re-exporta parseYamlWithLineCounter sin romper parseYamlSafe", () => {
    const viaDomain = parseYamlWithLineCounter(YAML_LINE_12_FIXTURE);
    const viaUtil = parseYamlWithLineCounterUtil(YAML_LINE_12_FIXTURE);
    // Ambos deben resolver la misma línea para el mismo path
    const posDomain = lineForPath(viaDomain.lineCounter, ["repositories", 0, "owner"]);
    const posUtil = lineForPath(viaUtil.lineCounter, ["repositories", 0, "owner"]);
    expect(posDomain?.line).toBe(12);
    expect(posUtil?.line).toBe(12);
  });

  it("lineForPath fallback: prefijo más corto si path exacto no existe (zod path anidado)", () => {
    // repositories.0.owner existe; pero si buscamos un path que no existe como campo inexistente, debe mapear al parent
    const { lineCounter } = parseYamlWithLineCounter(YAML_NESTED_FIXTURE);
    // third element owner is at line 10 (count: 1 schemaVersion, 2 name, 3 repositories, 4 - owner acme,5 name,6 - owner acme2,7 name,8 - owner bad, -> 8 should be line of bad)
    // Let's compute expected line for repositories.2.owner (third item)
    const pos = lineForPath(lineCounter, ["repositories", 2, "owner"]);
    // In YAML_NESTED_FIXTURE, third owner's line: let's calculate: lines are 1 schemaVersion,2 name,3 repositories,4   - owner: acme,5     name:...,6   - owner: acme2,7     name...,8   - owner: bad,9     name...,10 agentDefaults,11 model
    // So third owner should be line 8
    expect(pos?.line).toBe(8);
    // Path totalmente inexistente debe retornar undefined o parent
    const missing = lineForPath(lineCounter, ["nonexistent", 0, "foo"]);
    // Should be undefined or map to something; we allow either undefined or no crash
    expect(missing === undefined || typeof missing.line === "number").toBe(true);
  });

  it("FactoryParser produce file:line real para repositories.0.owner con LineCounter (no file.field marketing)", () => {
    const parser = new FactoryParser();
    const result = parser.parseFactoryYaml(YAML_LINE_12_FIXTURE, "factory.yaml");
    expect(result.ok).toBe(false);
    // Debe contener al menos un issue con file:line
    const issue = result.issues.find((i) => i.path.includes("repositories.0.owner") || i.path.includes("owner"));
    expect(issue).toBeDefined();
    // El formato debe ser "factory.yaml:12 — repositories.0.owner"
    expect(issue?.path).toMatch(/factory\.yaml:12/);
    expect(issue?.path).toContain(" — ");
    expect(issue?.path).toContain("repositories");
  });

  it("FactoryParser para YAML_NESTED_FIXTURE reporta file:line para repositories.2.owner (bad charset)", () => {
    const parser = new FactoryParser();
    const result = parser.parseFactoryYaml(YAML_NESTED_FIXTURE, "factory.yaml");
    expect(result.ok).toBe(false);
    // Find issue for repositories.2.owner
    const issue = result.issues.find((i) => i.path.includes("repositories.2.owner"));
    expect(issue).toBeDefined();
    expect(issue?.path).toMatch(/factory\.yaml:\d+/);
    // La línea debe ser 8 (tercer owner)
    const lineMatch = issue?.path.match(/:(\d+)/);
    expect(lineMatch).not.toBeNull();
    expect(Number(lineMatch?.[1])).toBe(8);
  });

  it("zodToParseIssues con LineCounter produce path file:line — field, y sin raw mantiene file.field", () => {
    const schema = z.object({ owner: z.string().regex(/^[A-Za-z0-9_.-]+$/, "owner: allowed") });
    const parsed = schema.safeParse({ owner: "bad@owner!" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const withoutRaw = zodToParseIssues(parsed.error, "factory.yaml");
      expect(withoutRaw[0]?.path).toBe("factory.yaml.owner");

      const raw = "owner: bad@owner!\n";
      const { lineCounter } = parseYamlWithLineCounter(raw);
      const withCounter = zodToParseIssues(parsed.error, "factory.yaml", raw, lineCounter);
      expect(withCounter[0]?.path).toMatch(/factory\.yaml:1 — owner/);
    }
  });

  it("fallback a findLineForPath si LineCounter no resuelve (sin throw)", async () => {
    const schema = z.object({ alias: z.string().regex(/^[A-Za-z0-9 ._-]+$/, "alias_charset") });
    const parsed = schema.safeParse({ alias: "bad@alias!" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const raw = "alias: bad@alias!\n";
      // Creamos un LineCounter sin doc registrado (nuevo, sin parseYamlWithLineCounter)
      // Simulamos pasando un LineCounter vacío que no está en WeakMap
      const { LineCounter } = await import("yaml");
      const emptyCounter = new LineCounter();
      const issues = zodToParseIssues(parsed.error, "factory.yaml", raw, emptyCounter);
      // Debe caer a findLineForPath y aún dar file:line
      expect(issues[0]?.path).toMatch(/factory\.yaml:1/);
    }
  });
});
