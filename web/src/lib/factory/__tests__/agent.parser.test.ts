import { describe, it, expect } from "vitest";
import { parseAgentMd } from "../parsers/agent.parser";

const validForeman = `---
description: Routes work
agentType: FOREMAN
model: auto
runner: linux-build
---
Own each work item from intake through human handoff.
`;

describe("AgentParser — parseAgentMd", () => {
  it("1. parses valid FOREMAN", () => {
    const r = parseAgentMd(validForeman, "agents/foreman/agent.md");
    expect(r.ok).toBe(true);
    expect(r.value?.name).toBe("foreman");
    expect(r.value?.agentType).toBe("FOREMAN");
  });
  it("2. parses TRIAGE", () => {
    const raw = validForeman.replace("FOREMAN", "TRIAGE");
    expect(parseAgentMd(raw, "agents/triage/agent.md").ok).toBe(true);
  });
  it("3. parses SPEC", () => {
    expect(parseAgentMd(validForeman.replace("FOREMAN", "SPEC"), "agents/spec/agent.md").ok).toBe(true);
  });
  it("4. parses IMPLEMENT", () => {
    expect(parseAgentMd(validForeman.replace("FOREMAN", "IMPLEMENT"), "agents/implement/agent.md").ok).toBe(true);
  });
  it("5. parses REVIEW", () => {
    expect(parseAgentMd(validForeman.replace("FOREMAN", "REVIEW"), "agents/review/agent.md").ok).toBe(true);
  });
  it("6. parses VERIFY", () => {
    expect(parseAgentMd(validForeman.replace("FOREMAN", "VERIFY"), "agents/verify/agent.md").ok).toBe(true);
  });
  it("7. parses CUSTOM default when agentType missing", () => {
    const raw = `---
model: auto
---
Do stuff.
`;
    const r = parseAgentMd(raw, "agents/custom/agent.md");
    expect(r.ok).toBe(true);
    expect(r.value?.agentType).toBe("CUSTOM");
  });
  it("8. parses with harness instead of model", () => {
    const raw = `---
agentType: IMPLEMENT
harness:
  type: oz
  model: auto
---
Build code.
`;
    expect(parseAgentMd(raw, "agents/implement/agent.md").ok).toBe(true);
  });
  it("9. parses with secrets and mcpServers", () => {
    const raw = `---
agentType: FOREMAN
model: auto
secrets:
  - SENTRY_TOKEN
mcpServers:
  sentry:
    warpId: SENTRY_ID
---
Coord.
`;
    const r = parseAgentMd(raw, "agents/foreman/agent.md");
    expect(r.ok).toBe(true);
    expect(r.value?.secrets).toEqual(["SENTRY_TOKEN"]);
  });
  it("10. parses with credentialStrategy and workerHost", () => {
    const raw = `---
agentType: REVIEW
model: auto
credentialStrategy: CREATOR
workerHost: SELF_HOSTED
---
Review.
`;
    expect(parseAgentMd(raw, "agents/review/agent.md").ok).toBe(true);
  });
  it("11. fails on empty input", () => {
    expect(parseAgentMd("", "agents/foreman/agent.md").ok).toBe(false);
  });
  it("12. fails on missing body", () => {
    const raw = `---
agentType: FOREMAN
model: auto
---
`;
    const r = parseAgentMd(raw, "agents/foreman/agent.md");
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toMatch(/body/);
  });
  it("13. fails when both model and harness set", () => {
    const raw = `---
agentType: FOREMAN
model: auto
harness:
  type: oz
  model: auto
---
Hello.
`;
    expect(parseAgentMd(raw, "agents/foreman/agent.md").ok).toBe(false);
  });
  it("14. fails on invalid agentType", () => {
    const raw = validForeman.replace("FOREMAN", "INVALID");
    expect(parseAgentMd(raw, "agents/foreman/agent.md").ok).toBe(false);
  });
  it("15. fails on oz harness with auth", () => {
    const raw = `---
agentType: FOREMAN
harness:
  type: oz
  model: auto
  auth:
    source: managedSecret
    secretName: KEY
---
Hello.
`;
    expect(parseAgentMd(raw, "agents/foreman/agent.md").ok).toBe(false);
  });
  it("16. fails on oz with auth (solo oz, sin credenciales)", () => {
    const raw = `---
agentType: IMPLEMENT
harness:
  type: oz
  model: auto
  auth:
    source: managedSecret
    secretName: SHOULD_FAIL
---
Hi.
`;
    expect(parseAgentMd(raw, "agents/implement/agent.md").ok).toBe(false);
  });
  it("17. extracts name from path fallback", () => {
    const raw = `---
model: auto
---
Body.
`;
    const r = parseAgentMd(raw, "some/other.md");
    expect(r.ok).toBe(true);
    expect(r.value?.name).toBe("other");
  });
  it("18. handles MAIN alias for FOREMAN", () => {
    const raw = validForeman.replace("FOREMAN", "MAIN");
    expect(parseAgentMd(raw, "agents/foreman/agent.md").ok).toBe(true);
  });
  it("19. parses multiline body preserves content", () => {
    const raw = `---
model: auto
---
Line1
Line2
- bullet
`;
    const r = parseAgentMd(raw, "agents/foreman/agent.md");
    expect(r.ok).toBe(true);
    expect(r.value?.instructions).toContain("bullet");
  });
  it("20. fails on mcpServers missing warpId", () => {
    const raw = `---
model: auto
mcpServers:
  sentry: {}
---
Body.
`;
    expect(parseAgentMd(raw, "agents/foreman/agent.md").ok).toBe(false);
  });
});
