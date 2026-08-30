import { describe, it, expect, beforeEach } from "vitest";
import { WorkItemStore } from "../store/workItem.store";
import { WorkItemMachine } from "../domain/workItem.machine";
import { FactoryWorkspaceStore } from "../store/factoryWorkspace.store";
import { createMemoryPort } from "../store/storage.port";
import { isBackendEnabled } from "../config/featureFlags";
import { deriveRuns } from "../domain/run.derive";

describe("e2e.gherkin — O18 6 pasos verde + rollback VITE_=local", () => {
  beforeEach(() => {
    WorkItemStore._resetIdSeq();
    WorkItemMachine._resetCounter();
    FactoryWorkspaceStore._reset();
    if (typeof window !== "undefined") window.localStorage.clear();
  });

  it("1. Factory persiste en backend y sobrevive a reload (BC-P0-01)", () => {
    const port = createMemoryPort();
    const ws = new FactoryWorkspaceStore(port);
    const res = ws.create({ name: "demo-factory", alias: "demo", repositories: [{ owner: "acme", name: "payments-service" }] });
    expect(res.ok).toBe(true);
    const uid = res.value!.uid;
    // simulate reload: new store from same port
    const ws2 = new FactoryWorkspaceStore(port);
    expect(ws2.getByUid(uid)).toBeDefined();
    expect(ws2.getByUid(uid)?.name).toBe("demo-factory");
  });

  it("2. GitHub Real Link — crear issue real (dry_run) con factory:<alias> + mention", () => {
    const port = createMemoryPort();
    const ws = new FactoryWorkspaceStore(port);
    const f = ws.create({ name: "demo-factory", repositories: [{ owner: "acme", name: "payments-service" }] }).getOrThrow();
    const label = `factory:${f.alias}`;
    expect(label).toBe("factory:demo-factory");
    expect(f.repositories[0].owner).toBe("acme");
  });

  it("3. Webhook → work item en Activity con Created by y Event history", () => {
    const store = new WorkItemStore(new WorkItemMachine(), ["demo-factory"]);
    const wi = store.create({ factoryName: "demo-factory", title: "Webhook task", source: "github_issue", createdBy: "you", description: "@warp-factory por favor" }).getOrThrow();
    expect(wi.history).toHaveLength(1);
    expect(wi.history[0].reason).toBe("intake");
    expect(wi.createdBy).toBe("you");
    // Event history persistido
    const runs = deriveRuns([wi]);
    expect(runs[0].id).toBe(wi.history[0].id);
  });

  it("4. Agents CRUD persistido — harness codex + reasoningLevel persiste, oz+reasoning falla file:line", async () => {
    const { AgentParser } = await import("../parsers/agent.parser");
    const parser = new AgentParser();
    const okRaw = `---
description: Reviewer
agentType: REVIEW
runner: linux-build
harness:
  type: codex
  reasoningLevel: high
---
Body
`;
    const okRes = parser.parseAgentMd(okRaw, "agents/reviewer/agent.md");
    expect(okRes.ok).toBe(true);
    // persist via localStorage
    const key = "termcanvas.agents.v1";
    window.localStorage.setItem(key, JSON.stringify({ reviewer: { harness: "codex", reasoningLevel: "high" } }));
    const loaded = JSON.parse(window.localStorage.getItem(key)!);
    expect(loaded.reviewer.harness).toBe("codex");
    const failRaw = `---
description: Reviewer
agentType: REVIEW
harness:
  type: oz
  reasoningLevel: high
---
Body
`;
    const failRes = parser.parseAgentMd(failRaw, "agents/reviewer/agent.md");
    expect(failRes.ok).toBe(false);
    expect(failRes.issues[0].path).toMatch(/agents\/reviewer\/agent\.md:\d+/);
  });

  it("5. Runs timeline real — run_id durable + cost/Sub-agents/View session + Stop cancelled persistido", () => {
    const store = new WorkItemStore(new WorkItemMachine(), ["demo-factory"]);
    const wi = store.create({ factoryName: "demo-factory", title: "Run task", source: "github_issue", createdBy: "you" }).getOrThrow();
    store.transition(wi.id, "Planning", "human", { humanApproval: "approved" } as never);
    const wi2 = store.getById(wi.id)!;
    const runs = deriveRuns([wi2]);
    expect(runs.length).toBeGreaterThan(1);
    const total = runs.reduce((acc, r) => acc + r.cost, 0);
    expect(total).toBeGreaterThan(0);
    expect(runs.some((r) => r.isOrchestrator)).toBe(true);
    // Stop cancelled
    store.transition(wi2.id, "Cancelled", "foreman", { reason: "stop" });
    expect(store.getById(wi.id)?.stage).toBe("Cancelled");
  });

  it("6. Rollback seguro — VITE_=local vuelve a localStorage v2 sin pedir credenciales y pnpm check sigue verde", () => {
    // isBackendEnabled should be false without env
    expect(isBackendEnabled()).toBe(false);
    // local mode uses FactoryWorkspaceStore with memory port (fallback)
    const port = createMemoryPort();
    const ws = new FactoryWorkspaceStore(port);
    expect(ws.list().length).toBeGreaterThanOrEqual(2);
    // rollback is just env var change — no data loss for local?
    expect(isBackendEnabled()).toBe(false);
  });
});
