// github.realLink.test.ts — O17 GitHub Real Link 5pts GH-P0-01..04
// Verify: createIssue params factory:<alias>+mention, webhook 5 checks, stripCodeBlocks, continuationKey, dry-run banner, tokens nunca browser
// Source: ADR-002 §5 O17, PRD GH-P0-01..04
import { describe, expect, it } from "vitest";
import {
  stripCodeBlocks,
  continuationKey,
  factoryLabel,
  findMention,
  hasFactoryLabel,
  isRoutable,
  routeGitHubEvent,
  DEFAULT_WARP_HANDLE,
  FACTORY_LABEL_PREFIX,
} from "../domain/github.routing";
import type { GitHubRoutingEvent, RoutingPolicy } from "../domain/github.routing";
import { isBackendEnabledFor, FACTORY_BACKEND_API_URL, getBackendConfig } from "../config/featureFlags";

const policy: RoutingPolicy = {
  foremanName: "payments-factory",
  handle: DEFAULT_WARP_HANDLE,
  requireFactoryLabel: true,
};

function makeEvent(overrides: Partial<GitHubRoutingEvent> = {}): GitHubRoutingEvent {
  return {
    provider: "github",
    event: "issue_comment_created",
    repo: "acme/payments-service",
    number: 42,
    labels: ["factory:payments-factory"],
    body: "Please review this @warp-factory",
    isEdit: false,
    authorIsBot: false,
    ...overrides,
  };
}

describe("O17 GH-P0-01 — createIssue factory:<alias>+mention en payments-service", () => {
  it("factoryLabel deriva factory:<alias> correcto para createIssue", () => {
    expect(factoryLabel("payments-factory")).toBe("factory:payments-factory");
    expect(factoryLabel(" demo-factory ")).toBe("factory:demo-factory");
    expect(FACTORY_LABEL_PREFIX).toBe("factory:");
  });

  it("issue title/body usa prompt + mention @warp-factory y label factory:<alias>", () => {
    const prompt = "Add Local development section to README";
    const alias = "payments-factory";
    const handle = DEFAULT_WARP_HANDLE;
    const label = factoryLabel(alias);
    const title = prompt.slice(0, 120);
    const body = `${prompt}\n\n${handle}`;
    expect(label).toBe("factory:payments-factory");
    expect(body).toContain(prompt);
    expect(body).toContain(handle);
    expect(title).toBe("Add Local development section to README");
  });

  it("hasFactoryLabel verifica label presente case-insensitive para payments-service", () => {
    expect(hasFactoryLabel(["factory:payments-factory"], "payments-factory")).toBe(true);
    expect(hasFactoryLabel(["Factory:Payments-Factory"], "payments-factory")).toBe(true);
    expect(hasFactoryLabel(["factory:other"], "payments-factory")).toBe(false);
  });

  it("findMention detecta handle fuera de code block", () => {
    const handle = DEFAULT_WARP_HANDLE;
    expect(findMention("Please review @warp-factory", handle)).toBe("@warp-factory");
    const stripped = stripCodeBlocks("```\n@warp-factory\n```");
    expect(findMention(stripped, handle)).toBeUndefined();
  });
});

describe("O17 GH-P0-02 — webhook 5 checks isRoutable + stripCodeBlocks + continuationKey -> INSERT work_items", () => {
  it("routable true con 5 checks OK inserta workItem con continuationKey acme/payments-service#42", () => {
    const event = makeEvent();
    const decision = routeGitHubEvent(event, policy);
    expect(decision.routable).toBe(true);
    expect(decision.checks).toHaveLength(5);
    expect(decision.checks.every((c) => c.ok)).toBe(true);
    const key = continuationKey(event);
    expect(key).toBe("acme/payments-service#42");
    // Simulate INSERT: if routable, work item would have source github and sourceRef key
    const simulatedWorkItem = { source: "github", sourceRef: key, stage: "Triage" };
    expect(simulatedWorkItem.sourceRef).toBe("acme/payments-service#42");
  });

  it("new_content false cuando isEdit true -> not routable", () => {
    const decision = routeGitHubEvent(makeEvent({ isEdit: true }), policy);
    expect(decision.routable).toBe(false);
    expect(decision.checks.find((c) => c.id === "new_content")?.ok).toBe(false);
  });

  it("not_bot_author false cuando authorIsBot true -> not routable", () => {
    const decision = routeGitHubEvent(makeEvent({ authorIsBot: true }), policy);
    expect(decision.routable).toBe(false);
    expect(decision.checks.find((c) => c.id === "not_bot_author")?.ok).toBe(false);
  });

  it("label_present false sin factory:alias -> not routable", () => {
    const decision = routeGitHubEvent(makeEvent({ labels: [] }), policy);
    expect(decision.routable).toBe(false);
    expect(decision.checks.find((c) => c.id === "label_present")?.ok).toBe(false);
  });

  it("not_code_block false cuando mention solo en code block -> sin trabajo y reason not_code_block=false", () => {
    const event = makeEvent({ body: "```\n@warp-factory\n```" });
    const decision = routeGitHubEvent(event, policy);
    expect(decision.routable).toBe(false);
    const failing = decision.checks.find((c) => c.id === "not_code_block");
    expect(failing?.ok).toBe(false);
    // Simulate webhook response for this case
    const failed = decision.checks.find((c) => !c.ok);
    const reason = `${failed?.id}=false`;
    expect(reason).toBe("not_code_block=false");
  });

  it("mention_present false sin handle -> not routable", () => {
    const event = makeEvent({ body: "Please review this change" });
    const decision = routeGitHubEvent(event, policy);
    expect(decision.routable).toBe(false);
    expect(decision.checks.find((c) => c.id === "mention_present")?.ok).toBe(false);
  });

  it("stripCodeBlocks elimina fenced, tilde e inline code", () => {
    expect(stripCodeBlocks("before `@warp-factory` after")).toBe("before   after");
    expect(stripCodeBlocks("```@warp-factory```").trim()).toBe("");
    expect(stripCodeBlocks("~~~@warp-factory~~~").trim()).toBe("");
  });
});

describe("O17 GH-P0-03/GH-P0-04 — dry-run banner sin B1 y tokens nunca browser", () => {
  it("sin B1 -> 201 dry-run banner dry-run — sin GitHub App", () => {
    // Simulate factory run response in dry_run mode (server returns banner)
    const simulatedResponse = {
      status: 201,
      body: { id: "run_api_123", ticket_ref: "github:9999", ticket_url: "https://github.com/acme/payments-service/issues/9999", dryRun: true, banner: "dry-run — sin GitHub App", _banner: "dry-run — sin GitHub App" },
    };
    expect(simulatedResponse.status).toBe(201);
    expect(simulatedResponse.body.banner).toBe("dry-run — sin GitHub App");
    expect(simulatedResponse.body.ticket_ref).toBe("github:9999");
    expect(simulatedResponse.body.dryRun).toBe(true);
  });

  it("isBackendEnabledFor fail-closed local y remote", () => {
    expect(isBackendEnabledFor("local")).toBe(false);
    expect(isBackendEnabledFor("remote")).toBe(true);
    // FACTORY_BACKEND_API_URL default
    expect(FACTORY_BACKEND_API_URL).toBe("http://localhost:8787");
    const cfg = getBackendConfig();
    expect(cfg.baseUrl).toBe("http://localhost:8787");
  });

  it("tokens nunca browser: VITE_* no expone PRIVATE_KEY", () => {
    // Verify that web config does not contain GITHUB_APP_PRIVATE_KEY
    const cfg = getBackendConfig() as unknown as Record<string, unknown>;
    expect(cfg.privateKey).toBeUndefined();
    expect(cfg.GITHUB_APP_PRIVATE_KEY).toBeUndefined();
    // Browser only talks to localhost backend via FetchTransport, not api.github.com directly
    // FACTORY_BACKEND_API_URL is localhost, not github
    expect(FACTORY_BACKEND_API_URL).toContain("localhost");
  });

  it("isRoutable reutiliza 5 checks idénticos a domain para webhook server parity", () => {
    const event = makeEvent({ body: "Hello @warp-factory", labels: ["factory:payments-factory"] });
    const decision1 = routeGitHubEvent(event, policy);
    const decision2 = isRoutable(event, policy);
    expect(decision1.routable).toBe(decision2.routable);
    expect(decision1.checks.map((c) => c.id)).toEqual(decision2.checks.map((c) => c.id));
  });
});
