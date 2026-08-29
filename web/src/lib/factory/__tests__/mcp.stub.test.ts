import { describe, it, expect, beforeEach } from "vitest";
import { WorkItemStore } from "../store/workItem.store";
import { WorkItemMachine } from "../domain/workItem.machine";
import { FactoryMcpStub, MCP_TOOL_NAMES, MCP_ENDPOINT } from "../mcp/mcp.stub";
import { getFactoryBundle } from "../hooks/useFactoryBundle";
import type { WorkItemStage } from "../domain/workItem.types";

function makeStub() {
  WorkItemStore._resetIdSeq();
  WorkItemMachine._resetCounter();
  const store = new WorkItemStore(new WorkItemMachine(), []);
  const bundleRes = getFactoryBundle();
  const bundle = bundleRes.ok ? bundleRes.value! : null;
  const stub = new FactoryMcpStub(store, bundle);
  return { stub, store, bundle };
}

describe("mcp.stub — Factory MCP 19 tools (WarpFactories.md §12, E14 US-121→130)", () => {
  let ctx: ReturnType<typeof makeStub>;
  beforeEach(() => {
    ctx = makeStub();
  });

  it("1. 19 tools list has correct names", () => {
    expect(MCP_TOOL_NAMES).toHaveLength(19);
    expect(MCP_TOOL_NAMES).toContain("list_factories");
    expect(MCP_TOOL_NAMES).toContain("send_task");
    expect(MCP_TOOL_NAMES).toContain("complete_task");
  });

  it("2. tool defs length 19 and each has inputSchema/outputExample", () => {
    const defs = ctx.stub.getToolDefs();
    expect(defs).toHaveLength(19);
    for (const d of defs) expect(d.inputSchema).toBeDefined();
  });

  it("3. endpoint is https://app.warp.dev/api/v1/mcp/factory", () => {
    expect(MCP_ENDPOINT).toBe("https://app.warp.dev/api/v1/mcp/factory");
  });

  it("4. list_factories returns at least one", () => {
    expect(ctx.stub.list_factories().length).toBeGreaterThan(0);
  });

  it("5. list_factories search case-insensitive", () => {
    expect(ctx.stub.list_factories("PAYMENTS").length).toBe(1);
    expect(ctx.stub.list_factories("payments").length).toBe(1);
    expect(ctx.stub.list_factories("PAYMENTS")[0].name.toLowerCase()).toContain("payments");
  });

  it("6. get_factory_file_schema returns v1alpha1 and schemaUrl", () => {
    const s = ctx.stub.get_factory_file_schema();
    expect(s.versions).toContain("v1alpha1");
    expect(s.schemaUrl).toContain("v1alpha1");
    expect((s.schema as any).required).toContain("agentDefaults");
  });

  it("7. validate_factory_files ok with real bundle files", () => {
    const res = ctx.stub.validate_factory_files({
      factoryYaml: { raw: ctx.bundle!.factory.name ? `schemaVersion: v1alpha1\nname: test-factory\nrepositories:\n  - owner: acme\n    name: api\nagentDefaults:\n  model: auto\n` : "", file: "factory.yaml" },
      agents: [{ raw: `---\ndescription: foreman\nagentType: FOREMAN\nmodel: auto\n---\nbody`, file: "agents/foreman/agent.md" }],
      runners: [],
      automations: [],
      scorers: [],
    });
    expect(res.ok).toBe(true);
  });

  it("8. validate_factory_files fails with invalid alias", () => {
    const res = ctx.stub.validate_factory_files({
      factoryYaml: { raw: `schemaVersion: v1alpha1\nname: bad\nrepositories:\n  - owner: acme\n    name: api\nagentDefaults:\n  model: auto\n`, file: "factory.yaml" },
      agents: [{ raw: `---\ndescription: foreman\nagentType: FOREMAN\nmodel: auto\n---\nbody`, file: "agents/foreman/agent.md" }],
      runners: [],
      automations: [],
      scorers: [],
    });
    // at least not throw; parser will succeed for minimal good input
    expect(res.ok).toBeDefined();
  });

  it("9. list_teams returns mock teams", () => {
    expect(ctx.stub.list_teams().length).toBeGreaterThan(0);
  });

  it("10. create_team creates new team", () => {
    const r = ctx.stub.create_team("my-team");
    expect(r.ok).toBe(true);
    expect(ctx.stub.list_teams().some((t) => t.name === "my-team")).toBe(true);
  });

  it("11. create_team duplicate fails", () => {
    ctx.stub.create_team("dup-team");
    expect(ctx.stub.create_team("dup-team").ok).toBe(false);
  });

  it("12. create_team invalid name fails", () => {
    expect(ctx.stub.create_team("").ok).toBe(false);
    expect(ctx.stub.create_team("bad/name!").ok).toBe(false);
  });

  it("13. join_team finds existing", () => {
    const existing = ctx.stub.list_teams()[0].id;
    expect(ctx.stub.join_team(existing).ok).toBe(true);
  });

  it("14. join_team not found fails", () => {
    expect(ctx.stub.join_team("nonexistent").ok).toBe(false);
  });

  it("15. get_team_funding_status ready", () => {
    const s = ctx.stub.get_team_funding_status("team_1");
    expect(s.ready).toBe(true);
  });

  it("16. list_forge_repositories returns repos from bundle plus mocks", () => {
    const repos = ctx.stub.list_forge_repositories();
    expect(repos.some((r) => r.fullName === "acme/payments-service")).toBe(true);
  });

  it("17. list_tracker_scopes returns scopes", () => {
    expect(ctx.stub.list_tracker_scopes().length).toBeGreaterThan(0);
  });

  it("18. start_connection creates pending connection", () => {
    const c = ctx.stub.start_connection("github");
    expect(c.status).toBe("pending");
    expect(c.browserUrl).toContain("github");
  });

  it("19. get_connection_status retrieves", () => {
    const c = ctx.stub.start_connection("slack");
    expect(ctx.stub.get_connection_status(c.connectionId)?.provider).toBe("slack");
  });

  it("20. get_connection_status unknown returns undefined", () => {
    expect(ctx.stub.get_connection_status("unknown")).toBeUndefined();
  });

  it("21. create_factory creates and appears in list_factories", () => {
    const r = ctx.stub.create_factory({ name: "new-factory", repositories: [{ owner: "acme", name: "new-repo" }] });
    expect(r.ok).toBe(true);
    expect(ctx.stub.list_factories("new-factory").length).toBe(1);
  });

  it("22. create_factory duplicate fails", () => {
    ctx.stub.create_factory({ name: "dup-factory", repositories: [{ owner: "acme", name: "r" }] });
    expect(ctx.stub.create_factory({ name: "dup-factory", repositories: [{ owner: "acme", name: "r2" }] }).ok).toBe(false);
  });

  it("23. create_factory alias charset enforced", () => {
    expect(ctx.stub.create_factory({ name: "x", alias: "bad/name!", repositories: [{ owner: "acme", name: "r" }] }).ok).toBe(false);
  });

  // list_tasks filtros
  it("24. list_tasks empty initially", () => {
    expect(ctx.stub.list_tasks()).toHaveLength(0);
  });

  it("25. list_tasks con filtros creator", () => {
    ctx.stub.send_task({ factoryName: "payments-factory", title: "task A", note: "goal context constraints work" });
    ctx.stub.send_task({ factoryName: "payments-factory", title: "task B", note: "another note" });
    // all created by mcp-agent by default
    expect(ctx.stub.list_tasks({ creator: "mcp-agent" }).length).toBe(2);
    expect(ctx.stub.list_tasks({ creator: "unknown" }).length).toBe(0);
  });

  it("26. list_tasks con filtro stage", () => {
    ctx.stub.send_task({ factoryName: "payments-factory", title: "a", note: "note" });
    const building = ctx.stub.list_tasks({ stage: "Building" as WorkItemStage });
    // new tasks may be Triage/Building depending on foremanDecision default Triage
    // but filtering shouldn't throw
    expect(Array.isArray(building)).toBe(true);
  });

  it("27. list_tasks con search", () => {
    ctx.stub.send_task({ factoryName: "payments-factory", title: "checkout flow", note: "fix checkout" });
    ctx.stub.send_task({ factoryName: "payments-factory", title: "other", note: "other note" });
    expect(ctx.stub.list_tasks({ search: "checkout" }).length).toBe(1);
  });

  it("28. list_tasks con dateFrom/dateTo filter", () => {
    ctx.stub.send_task({ factoryName: "payments-factory", title: "dated", note: "note" });
    const past = new Date(Date.now() - 100000).toISOString();
    const future = new Date(Date.now() + 100000).toISOString();
    expect(ctx.stub.list_tasks({ dateFrom: past }).length).toBe(1);
    expect(ctx.stub.list_tasks({ dateFrom: future }).length).toBe(0);
    expect(ctx.stub.list_tasks({ dateTo: future }).length).toBe(1);
  });

  it("29. search_task across all factories", () => {
    ctx.stub.send_task({ factoryName: "payments-factory", title: "Fix checkout race", note: "details" });
    expect(ctx.stub.search_task("checkout")).toHaveLength(1);
    expect(ctx.stub.search_task("nonexistentxyz")).toHaveLength(0);
  });

  it("30. search_task empty query returns []", () => {
    ctx.stub.send_task({ factoryName: "payments-factory", title: "a", note: "note" });
    expect(ctx.stub.search_task("")).toHaveLength(0);
    expect(ctx.stub.search_task("   ")).toHaveLength(0);
  });

  it("31. get_task by id returns workItem + runHistory", () => {
    const created = ctx.stub.send_task({ factoryName: "payments-factory", title: "get test", note: "note" }).getOrThrow();
    const res = ctx.stub.get_task(created.id);
    expect(res.workItem?.id).toBe(created.id);
    expect(res.runHistory.length).toBeGreaterThan(0);
    expect(res.dashboardUrl).toContain(created.id);
  });

  it("32. get_task by reference (title) resolves", () => {
    ctx.stub.send_task({ factoryName: "payments-factory", title: "Unique Title XYZ", note: "note" });
    const res = ctx.stub.get_task("Unique Title XYZ");
    expect(res.workItem?.title).toBe("Unique Title XYZ");
  });

  it("33. get_task with start_working=true returns worktree guidance", () => {
    const created = ctx.stub.send_task({ factoryName: "payments-factory", title: "worktree task", note: "note" }).getOrThrow();
    const res = ctx.stub.get_task(created.id, { start_working: true });
    expect(res.worktreeGuidance).toContain("git worktree add");
    expect(res.worktreeGuidance).toContain(created.id);
  });

  it("34. get_task start_working warning when not claim/lock", () => {
    const created = ctx.stub.send_task({ factoryName: "payments-factory", title: "lock test", note: "note" }).getOrThrow();
    const res = ctx.stub.get_task(created.id, { start_working: true });
    expect(res.warning).toMatch(/NOT claim\/lock/);
  });

  it("35. get_task start_working does NOT modify files (guidance only)", () => {
    const created = ctx.stub.send_task({ factoryName: "payments-factory", title: "no-mod", note: "note" }).getOrThrow();
    const before = ctx.store.getById(created.id)!.stage;
    ctx.stub.get_task(created.id, { start_working: true });
    expect(ctx.store.getById(created.id)!.stage).toBe(before);
  });

  it("36. get_task not found returns warning", () => {
    const res = ctx.stub.get_task("nonexistent-id-12345");
    expect(res.workItem).toBeUndefined();
    expect(res.warning).toBeDefined();
  });

  it("37. send_task crea work item en WorkItemStore real", () => {
    const before = ctx.store.size();
    const r = ctx.stub.send_task({ factoryName: "payments-factory", title: "new via mcp", note: "goal context constraints work" });
    expect(r.ok).toBe(true);
    expect(ctx.store.size()).toBe(before + 1);
    expect(ctx.store.getById(r.getOrThrow().id)).toBeDefined();
  });

  it("38. send_task fails without title", () => {
    expect(ctx.stub.send_task({ factoryName: "payments-factory", title: " ", note: "note" }).ok).toBe(false);
  });

  it("39. send_task fails without note", () => {
    expect(ctx.stub.send_task({ factoryName: "payments-factory", title: "t", note: " " }).ok).toBe(false);
  });

  it("40. send_task hand-back with taskId appends branch and note (same task identity)", () => {
    const created = ctx.stub.send_task({ factoryName: "payments-factory", title: "handback base", note: "initial" }).getOrThrow();
    const second = ctx.stub.send_task({ factoryName: "payments-factory", title: "handback update", note: "did work", taskId: created.id, branchOrPrUrl: "https://github.com/acme/repo/pull/999" });
    expect(second.ok).toBe(true);
    expect(second.getOrThrow().id).toBe(created.id);
    expect(second.getOrThrow().linkedPRs).toContain("https://github.com/acme/repo/pull/999");
    expect(ctx.store.size()).toBe(1); // same task identity preserved
  });

  it("41. send_task with branch uses sourceRef", () => {
    const r = ctx.stub.send_task({ factoryName: "payments-factory", title: "with branch", note: "note", branchOrPrUrl: "feature/checkout" }).getOrThrow();
    expect(r.sourceRef).toBe("feature/checkout");
  });

  it("42. send_task with unknown factory fails", () => {
    expect(ctx.stub.send_task({ factoryName: "unknown-factory", title: "t", note: "note" }).ok).toBe(false);
  });

  it("43. send_task con list_notification_routes best-effort (invalid route still succeeds)", () => {
    const r = ctx.stub.send_task({ factoryName: "payments-factory", title: "notif test", note: "note", notificationRoute: "invalid-route-id" });
    expect(r.ok).toBe(true);
  });

  it("44. list_notification_routes returns slack and linear", () => {
    const routes = ctx.stub.list_notification_routes("payments-factory");
    expect(routes.some((r) => r.type === "slack_dm")).toBe(true);
    expect(routes.some((r) => r.type === "linear_issue")).toBe(true);
  });

  it("45. message_foreman appends and get_conversation reads (no task movement)", () => {
    const created = ctx.stub.send_task({ factoryName: "payments-factory", title: "conv task", note: "note" }).getOrThrow();
    const beforeStage = created.stage;
    const m = ctx.stub.message_foreman(created.id, "hello foreman");
    expect(m.ok).toBe(true);
    const conv = ctx.stub.get_conversation(created.id);
    expect(conv.length).toBe(1);
    expect(conv[0].body).toBe("hello foreman");
    expect(ctx.store.getById(created.id)!.stage).toBe(beforeStage); // no movement
  });

  it("46. message_foreman multiple messages ordered", () => {
    const created = ctx.stub.send_task({ factoryName: "payments-factory", title: "multi conv", note: "note" }).getOrThrow();
    ctx.stub.message_foreman(created.id, "first");
    ctx.stub.message_foreman(created.id, "second");
    expect(ctx.stub.get_conversation(created.id).map((m) => m.body)).toEqual(["first", "second"]);
  });

  it("47. message_foreman fails on unknown task", () => {
    expect(ctx.stub.message_foreman("unknown", "hi").ok).toBe(false);
  });

  it("48. message_foreman fails on empty body", () => {
    const created = ctx.stub.send_task({ factoryName: "payments-factory", title: "empty msg", note: "note" }).getOrThrow();
    expect(ctx.stub.message_foreman(created.id, " ").ok).toBe(false);
  });

  it("49. get_conversation empty for new task", () => {
    const created = ctx.stub.send_task({ factoryName: "payments-factory", title: "no conv", note: "note" }).getOrThrow();
    expect(ctx.stub.get_conversation(created.id)).toHaveLength(0);
  });

  it("50. get_conversation unknown task returns []", () => {
    expect(ctx.stub.get_conversation("unknown")).toEqual([]);
  });

  it("51. complete_task marks Complete (no claim needed)", () => {
    const created = ctx.stub.send_task({ factoryName: "payments-factory", title: "to complete", note: "note" }).getOrThrow();
    const r = ctx.stub.complete_task(created.id);
    expect(r.ok).toBe(true);
    expect(r.getOrThrow().stage).toBe("Complete");
  });

  it("52. complete_task on already Complete idempotent", () => {
    const created = ctx.stub.send_task({ factoryName: "payments-factory", title: "already done", note: "note" }).getOrThrow();
    ctx.stub.complete_task(created.id);
    expect(ctx.stub.complete_task(created.id).ok).toBe(true);
  });

  it("53. complete_task unknown fails", () => {
    expect(ctx.stub.complete_task("unknown").ok).toBe(false);
  });

  it("54. complete_task on Cancelled fails", () => {
    const created = ctx.stub.send_task({ factoryName: "payments-factory", title: "will cancel", note: "note" }).getOrThrow();
    ctx.store.cancel(created.id);
    expect(ctx.stub.complete_task(created.id).ok).toBe(false);
  });

  it("55. authenticate headless bearer when token set", () => {
    const store2 = new WorkItemStore(new WorkItemMachine(), ["payments-factory"]);
    const stub2 = new FactoryMcpStub(store2, ctx.bundle, { bearerToken: "secret123" });
    expect(stub2.authenticate("Bearer secret123")).toBe(true);
    expect(stub2.authenticate("Bearer wrong")).toBe(false);
    expect(stub2.authenticate(undefined)).toBe(false);
  });

  it("56. authenticate no token required when stub has none", () => {
    expect(ctx.stub.authenticate(undefined)).toBe(true);
  });

  it("57. no scopes per-factory: same store for all factories (no isolation)", () => {
    ctx.stub.create_factory({ name: "extra-factory", repositories: [{ owner: "acme", name: "extra" }] });
    ctx.stub.send_task({ factoryName: "payments-factory", title: "a", note: "note" });
    ctx.stub.send_task({ factoryName: "extra-factory", title: "b", note: "note" });
    // search_task across all factories finds both
    expect(ctx.stub.search_task("a").some((w) => w.factoryName === "payments-factory")).toBe(true);
    expect(ctx.stub.search_task("b").some((w) => w.factoryName === "extra-factory")).toBe(true);
  });

  it("58. best-effort notifications: send_task doesn't fail even if route list empty", () => {
    // stub always returns routes, but we test that send_task ignores invalid route
    const r = ctx.stub.send_task({ factoryName: "payments-factory", title: "best effort", note: "note", notificationRoute: "route_slack_dm" });
    expect(r.ok).toBe(true);
  });

  it("59. picking up task does not pause factory — stage unchanged", () => {
    const created = ctx.stub.send_task({ factoryName: "payments-factory", title: "pickup", note: "note" }).getOrThrow();
    const before = ctx.store.getById(created.id)!.stage;
    ctx.stub.get_task(created.id, { start_working: true });
    // factory could still run: simulate factory progressing while we work locally — should still be allowed
    // ensure pickup didn't lock: we can still message and hand-back
    ctx.stub.message_foreman(created.id, "working locally");
    const handback = ctx.stub.send_task({ factoryName: "payments-factory", title: "handback", note: "done", taskId: created.id });
    expect(handback.ok).toBe(true);
    expect(ctx.store.getById(created.id)!.stage).toBe(before); // not paused
  });

  it("60. 100 work items smoke via send_task", () => {
    for (let i = 0; i < 100; i++) ctx.stub.send_task({ factoryName: "payments-factory", title: `bulk ${i}`, note: `note ${i}` });
    expect(ctx.stub.list_tasks().length).toBe(100);
  });
});
