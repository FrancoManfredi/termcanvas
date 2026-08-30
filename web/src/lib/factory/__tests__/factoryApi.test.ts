import { beforeEach, describe, expect, it } from "vitest";
import { FactoryWorkspaceStore } from "../store/factoryWorkspace.store";
import { WorkItemStore } from "../store/workItem.store";
import { createMemoryPort } from "../store/storage.port";
import { createFactoryApiRuntime, resetFactoryApiRunIds } from "../domain/factoryApi.routes";

function setup() {
  const workspace = new FactoryWorkspaceStore(createMemoryPort());
  const workItems = new WorkItemStore(undefined, workspace.list().map((factory) => factory.name));
  return createFactoryApiRuntime(workspace, workItems);
}

describe("Factory API contract", () => {
  beforeEach(() => resetFactoryApiRunIds());

  it("lists factories and filters by name or alias case-insensitively", () => {
    const runtime = setup();
    const all = runtime.router.dispatch("GET", "/api/v1/factory");
    expect(all.status).toBe(200);
    expect((all.body as { factories: readonly unknown[] }).factories).toHaveLength(2);

    const filtered = runtime.router.dispatch("GET", "/api/v1/factory?search=PAYMENTS");
    expect((filtered.body as { factories: readonly { name: string }[] }).factories.map((factory) => factory.name)).toEqual(["payments-factory"]);
  });

  it("gets one factory and returns 404 for an unknown uid", () => {
    const runtime = setup();
    const found = runtime.router.dispatch("GET", "/api/v1/factory/uid_payments-factory_1");
    expect(found.status).toBe(200);
    expect((found.body as { factory: { alias: string } }).factory.alias).toBe("payments-factory");
    expect(runtime.router.dispatch("GET", "/api/v1/factory/nope").status).toBe(404);
  });

  it("requires prompt and validates ticket_ref before creating a work item", () => {
    const runtime = setup();
    const missing = runtime.router.dispatch("POST", "/api/v1/factory/uid_payments-factory_1/runs", {});
    expect(missing.status).toBe(400);
    expect((missing.body as { code: string }).code).toBe("missing_prompt");

    const invalid = runtime.router.dispatch("POST", "/api/v1/factory/uid_payments-factory_1/runs", { prompt: "Fix it", ticket_ref: "PAY-123" });
    expect(invalid.status).toBe(400);
    expect((invalid.body as { code: string }).code).toBe("invalid_ticket_ref");
    expect(runtime.workItems.size()).toBe(0);
  });

  it("dispatches a run with derived title and keeps ticket metadata", () => {
    const runtime = setup();
    const response = runtime.router.dispatch("POST", "/api/v1/factory/uid_payments-factory_1/runs", {
      prompt: "Fix checkout race\nInclude a regression test",
      ticket_ref: "linear:PAY-123",
      ticket_url: "https://linear.app/acme/issue/PAY-123",
    });
    expect(response.status).toBe(201);
    const run = response.body as { id: string; title: string; stage: string; ticket_ref: string; work_item_id: string };
    expect(run.id).toMatch(/^run_api_/);
    expect(run.title).toBe("Fix checkout race");
    expect(run.stage).toBe("Triage");
    expect(run.ticket_ref).toBe("linear:PAY-123");
    expect(runtime.workItems.getById(run.work_item_id)?.description).toContain("Include a regression test");
  });

  it("supports get, follow-up, and cancel through Agent API paths", () => {
    const runtime = setup();
    const created = runtime.router.dispatch("POST", "/api/v1/factory/uid_payments-factory_1/runs", { prompt: "Investigate" });
    const id = (created.body as { id: string }).id;
    expect(runtime.router.dispatch("GET", `/agent/runs/${id}`).status).toBe(200);

    const followup = runtime.router.dispatch("POST", `/agent/runs/${id}/followups`, { prompt: "Focus on checkout" });
    expect(followup.status).toBe(200);
    expect((followup.body as { status: string; followups: readonly string[] }).status).toBe("running");
    expect((followup.body as { followups: readonly string[] }).followups).toEqual(["Focus on checkout"]);

    const cancelled = runtime.router.dispatch("POST", `/agent/runs/${id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect((cancelled.body as { status: string }).status).toBe("cancelled");
    expect(runtime.workItems.list({ includeTerminals: true })[0]?.stage).toBe("Cancelled");
  });

  it("supports standalone Agent API runs", () => {
    const runtime = setup();
    const response = runtime.router.dispatch("POST", "/agent/run", { prompt: "Summarize the repository" });
    expect(response.status).toBe(201);
    expect((response.body as { title: string; prompt: string }).title).toBe("Summarize the repository");
    expect((response.body as { prompt: string }).prompt).toBe("Summarize the repository");
  });
});
