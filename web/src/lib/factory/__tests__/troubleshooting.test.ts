import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import * as React from "react";
import {
  SETUP_ROWS,
  WORK_NOT_STARTING_LEAD,
  WORK_SOURCES,
  TWO_RUNS_WARNING,
  RUNS_ROWS,
  TROUBLESHOOTING_META,
} from "../domain/troubleshooting.data";
import { HelpSection } from "../../../components/help/HelpSection";
import { TroubleshootingPage } from "../../../components/help/TroubleshootingPage";

// Helper to read file content via fetch is not needed — we check JS runtime strings
// Instead we assert static data is exact per doc

describe("troubleshooting.data — WarpFactories.md §18 exact names (no inventados)", () => {
  it("TROUBLESHOOTING_META has exact title Help / Troubleshooting and subtitle §18", () => {
    expect(TROUBLESHOOTING_META.title).toBe("Help / Troubleshooting");
    expect(TROUBLESHOOTING_META.subtitle).toMatch(/§18/);
    expect(TROUBLESHOOTING_META.subtitle).toMatch(/Last updated Aug 27, 2026/);
  });

  describe("Setting up — 4 casos US-145 (WarpFactories.md:1550)", () => {
    it("has exactly 4 rows", () => {
      expect(SETUP_ROWS).toHaveLength(4);
    });
    it("row 1: Don't have access", () => {
      const r = SETUP_ROWS[0];
      expect(r.symptom).toBe("Don't have access");
      expect(r.cause).toBe("Early Access por team");
      expect(r.fix).toMatch(/Request access/);
      expect(r.fix).toMatch(/admin confirme team membership/);
    });
    it("row 2: Repo no aparece en picker", () => {
      const r = SETUP_ROWS[1];
      expect(r.symptom).toBe("Repo no aparece en picker");
      expect(r.cause).toBe("Code host connection no cubre repo");
      expect(r.fix).toMatch(/Confirmar org\/group/);
      expect(r.fix).toMatch(/owner\/GitLab group owner\/Warp admin extienda/);
    });
    it("row 3: Setup stops at agent limit", () => {
      const r = SETUP_ROWS[2];
      expect(r.symptom).toBe("Setup stops at agent limit");
      expect(r.cause).toBe("Plan limits");
      expect(r.fix).toMatch(/Admin confirme capacity/);
      expect(r.fix).toMatch(/contactar sales/);
    });
    it("row 4: Web app sigue mostrando setup wizard después de que agent creó factory vía MCP", () => {
      const r = SETUP_ROWS[3];
      expect(r.symptom).toBe("Web app sigue mostrando setup wizard después de que agent creó factory vía MCP");
      expect(r.cause).toBe("Browser page abierta no se actualiza");
      expect(r.fix).toBe("Refresh; link que compartió el agent abre la misma factory");
    });
    it("symptoms are unique", () => {
      const symptoms = SETUP_ROWS.map((r) => r.symptom);
      expect(new Set(symptoms).size).toBe(4);
    });
    it("all rows have non-empty cause and fix", () => {
      for (const r of SETUP_ROWS) {
        expect(r.cause.length).toBeGreaterThan(0);
        expect(r.fix.length).toBeGreaterThan(0);
      }
    });
    it("covers 100 alias variations not needed but covers 4/4 exact names without invention", () => {
      const expectedSymptoms = [
        "Don't have access",
        "Repo no aparece en picker",
        "Setup stops at agent limit",
        "Web app sigue mostrando setup wizard después de que agent creó factory vía MCP",
      ];
      expect(SETUP_ROWS.map((r) => r.symptom)).toEqual(expectedSymptoms);
    });
  });

  describe("Work isn't starting — automation mismatch lead + per-source US-146", () => {
    it("lead contains Casi siempre es automation mismatch, no conexión rota", () => {
      expect(WORK_NOT_STARTING_LEAD).toMatch(/Casi siempre es automation mismatch, no conexión rota/);
    });
    it("lead contains every filter AND and single mismatch frena", () => {
      expect(WORK_NOT_STARTING_LEAD).toMatch(/every filter AND/);
      expect(WORK_NOT_STARTING_LEAD).toMatch(/single mismatch frena/);
    });
    it("lead contains source conectado a esta factory", () => {
      expect(WORK_NOT_STARTING_LEAD).toMatch(/source conectado a esta factory/);
      expect(WORK_NOT_STARTING_LEAD).toMatch(/conectar al workspace no adjunta a todas/);
    });
    it("lead mentions enabled + event type matchea", () => {
      expect(WORK_NOT_STARTING_LEAD).toMatch(/enabled/);
      expect(WORK_NOT_STARTING_LEAD).toMatch(/event type matchea/);
    });
    it("WORK_SOURCES has 5 sources in order Slack GitHub GitLab Linear Jira", () => {
      expect(WORK_SOURCES).toHaveLength(5);
      expect(WORK_SOURCES.map((s) => s.source)).toEqual(["Slack", "GitHub", "GitLab", "Linear", "Jira"]);
    });
    it("Slack: App isn't in channel, pending admin approval, account no linkeada", () => {
      const slack = WORK_SOURCES.find((s) => s.source === "Slack")!;
      expect(slack.causes).toMatch(/App isn't in channel/);
      expect(slack.causes).toMatch(/pending admin approval/);
      expect(slack.causes).toMatch(/account no linkeada a Warp team member/);
    });
    it("GitHub: App no cubre repo + factory:<alias> missing + event type + single filter mismatch", () => {
      const gh = WORK_SOURCES.find((s) => s.source === "GitHub")!;
      expect(gh.causes).toMatch(/App no cubre repo/);
      expect(gh.causes).toMatch(/repo no pertenece a factory/);
      expect(gh.causes).toMatch(/factory:<alias>/);
      expect(gh.causes).toMatch(/event type no incluido/);
      expect(gh.causes).toMatch(/single filter mismatch/);
      expect(gh.causes).toMatch(/Authors, Labels/);
    });
    it("GitLab: Mention es edit no new comment + username inexacto + project no seleccionado + automation disabled + group webhooks", () => {
      const gl = WORK_SOURCES.find((s) => s.source === "GitLab")!;
      expect(gl.causes).toMatch(/Mention es edit no new comment/);
      expect(gl.causes).toMatch(/username inexacto/);
      expect(gl.causes).toMatch(/project no seleccionado/);
      expect(gl.causes).toMatch(/automation disabled/);
      expect(gl.causes).toMatch(/plan sin group webhooks/);
      expect(gl.causes).toMatch(/Premium\/Ultimate/);
    });
    it("Linear: Agent session requiere linked Warp account + teams/filters mismatch + agent_session_created routing solo editable en files", () => {
      const linear = WORK_SOURCES.find((s) => s.source === "Linear")!;
      expect(linear.causes).toMatch(/Agent session requiere linked Warp account/);
      expect(linear.causes).toMatch(/teams\/filters mismatch/);
      expect(linear.causes).toMatch(/agent_session_created/);
      expect(linear.causes).toMatch(/solo editable en files/);
    });
    it("Jira: Warp app no conectada + agent_session_created disabled + filters project/keywords mismatch", () => {
      const jira = WORK_SOURCES.find((s) => s.source === "Jira")!;
      expect(jira.causes).toMatch(/Warp app no conectada/);
      expect(jira.causes).toMatch(/agent_session_created/);
      expect(jira.causes).toMatch(/disabled/);
      expect(jira.causes).toMatch(/project\/keywords mismatch/);
    });
    it("causes are unique per source", () => {
      const causes = WORK_SOURCES.map((s) => s.causes);
      expect(new Set(causes).size).toBe(5);
    });
  });

  describe("Two runs warning — US-147 overlapping app_mention + message_posted", () => {
    it("warning mentions Un action que dispara dos runs", () => {
      expect(TWO_RUNS_WARNING).toMatch(/Un action que dispara dos runs/);
    });
    it("warning mentions dos automations matchean mismo event", () => {
      expect(TWO_RUNS_WARNING).toMatch(/dos automations matchean mismo event/);
    });
    it("warning mentions app_mention + message_posted mismo channel", () => {
      expect(TWO_RUNS_WARNING).toMatch(/app_mention/);
      expect(TWO_RUNS_WARNING).toMatch(/message_posted/);
      expect(TWO_RUNS_WARNING).toMatch(/mismo channel/);
    });
    it("warning mentions angostar/remover overlapping", () => {
      expect(TWO_RUNS_WARNING).toMatch(/angostar\/remover overlapping/);
    });
    it("warning mentions how matching works", () => {
      expect(TWO_RUNS_WARNING).toMatch(/how matching works/);
    });
  });

  describe("Runs and work items — US-148 (3 filas)", () => {
    it("has exactly 3 rows", () => {
      expect(RUNS_ROWS).toHaveLength(3);
    });
    it("row 1: Need to stop run → Activity Stop task inmediato sin confirmación", () => {
      const r = RUNS_ROWS[0];
      expect(r.symptom).toBe("Need to stop run");
      expect(r.fix).toMatch(/Activity/);
      expect(r.fix).toMatch(/select work item/);
      expect(r.fix).toMatch(/Stop task/);
      expect(r.fix).toMatch(/inmediato, sin confirmación/);
    });
    it("row 2: Work item looks stuck → A menudo esperando a persona, no fallando", () => {
      const r = RUNS_ROWS[1];
      expect(r.symptom).toBe("Work item looks stuck");
      expect(r.fix).toMatch(/A menudo esperando a persona, no fallando/);
      expect(r.fix).toMatch(/spec approval/);
      expect(r.fix).toMatch(/clarifying questions/);
      expect(r.fix).toMatch(/event history/i);
      expect(r.fix).toMatch(/View agent/);
      expect(r.fix).toMatch(/steer si activo vía cloud agent session sharing/);
    });
    it("row 3: No pull request → Implement agent enabled + Building stage + branch protection", () => {
      const r = RUNS_ROWS[2];
      expect(r.symptom).toBe("No pull request");
      expect(r.fix).toMatch(/Implement agent enabled/);
      expect(r.fix).toMatch(/code host write access/);
      expect(r.fix).toMatch(/Building stage/);
      expect(r.fix).toMatch(/branch protection aplica/);
    });
    it("symptoms unique", () => {
      expect(new Set(RUNS_ROWS.map((r) => r.symptom)).size).toBe(3);
    });
  });

  describe("HelpSection — SOLID: page lista, section muestra, DIP no necesita store", () => {
    it("renders title and description and children", () => {
      const { container } = render(
        React.createElement(HelpSection, { id: "test-section", title: "Test Title", description: "Desc" }, "Child content")
      );
      expect(screen.getByText("Test Title")).toBeInTheDocument();
      expect(screen.getByText("Desc")).toBeInTheDocument();
      expect(screen.getByText("Child content")).toBeInTheDocument();
      const section = container.querySelector("section#test-section");
      expect(section).not.toBeNull();
      expect(section?.getAttribute("aria-labelledby")).toBe("test-section-heading");
    });
    it("renders without description", () => {
      render(React.createElement(HelpSection, { id: "no-desc", title: "Only Title" }, "Body"));
      expect(screen.getByText("Only Title")).toBeInTheDocument();
      expect(screen.getByText("Body")).toBeInTheDocument();
    });
    it("HelpSection source does not import store (DIP)", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const filePath = path.resolve("src/components/help/HelpSection.tsx");
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toMatch(/useWorkItems|WorkItemStore|workItem\.store/);
      expect(content).not.toMatch(/console\.log\(/);
    });
  });

  describe("TroubleshootingPage — tablas renderizan (component)", () => {
    it("renders Help / Troubleshooting heading and subtitle §18", () => {
      render(React.createElement(TroubleshootingPage));
      expect(screen.getByText("Help / Troubleshooting")).toBeInTheDocument();
      expect(screen.getAllByText(/WarpFactories\.md §18/).length).toBeGreaterThanOrEqual(1);
    });
    it("renders Setting up table with 4 sintomas", () => {
      render(React.createElement(TroubleshootingPage));
      expect(screen.getByText("Setting up")).toBeInTheDocument();
      expect(screen.getByText("Don't have access")).toBeInTheDocument();
      expect(screen.getByText("Repo no aparece en picker")).toBeInTheDocument();
      expect(screen.getByText("Setup stops at agent limit")).toBeInTheDocument();
      expect(screen.getByText("Web app sigue mostrando setup wizard después de que agent creó factory vía MCP")).toBeInTheDocument();
      // verify cause/fix columns present
      expect(screen.getByText("Early Access por team")).toBeInTheDocument();
      expect(screen.getByText("Browser page abierta no se actualiza")).toBeInTheDocument();
    });
    it("renders Setting up table has thead Síntoma/Causa/Fix", () => {
      render(React.createElement(TroubleshootingPage));
      const table = screen.getByLabelText("Setting up troubleshooting table");
      const headers = within(table).getAllByRole("columnheader");
      expect(headers.map((h) => h.textContent)).toEqual(["Síntoma", "Causa", "Fix"]);
      expect(within(table).getAllByRole("row")).toHaveLength(5); // 1 header + 4 rows
    });
    it("renders Work isn't starting lead and per-source causas", () => {
      render(React.createElement(TroubleshootingPage));
      expect(screen.getByText("Work isn't starting")).toBeInTheDocument();
      expect(screen.getByText(/Casi siempre es automation mismatch, no conexión rota/)).toBeInTheDocument();
      expect(screen.getByText("Slack")).toBeInTheDocument();
      expect(screen.getByText(/App isn't in channel/)).toBeInTheDocument();
      expect(screen.getByText("GitHub")).toBeInTheDocument();
      expect(screen.getAllByText(/factory:<alias>/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("GitLab")).toBeInTheDocument();
      expect(screen.getByText(/group webhooks/)).toBeInTheDocument();
      expect(screen.getByText("Linear")).toBeInTheDocument();
      expect(screen.getAllByText(/agent_session_created/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Jira")).toBeInTheDocument();
      expect(screen.getByText(/project\/keywords mismatch/)).toBeInTheDocument();
    });
    it("renders Work isn't starting per-source table has 5 rows + header", () => {
      render(React.createElement(TroubleshootingPage));
      const table = screen.getByLabelText("Work isn't starting per-source causes");
      expect(within(table).getAllByRole("row")).toHaveLength(6); // header + 5
      const srcCells = within(table).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
      expect(srcCells).toEqual(["Slack", "GitHub", "GitLab", "Linear", "Jira"]);
    });
    it("renders Two runs warning with app_mention + message_posted", () => {
      render(React.createElement(TroubleshootingPage));
      expect(screen.getByText(/Two runs warning:/)).toBeInTheDocument();
      expect(screen.getAllByText(/app_mention/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/message_posted/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/angostar\/remover overlapping/)).toBeInTheDocument();
    });
    it("renders Runs and work items table with Stop task sin confirmación", () => {
      render(React.createElement(TroubleshootingPage));
      expect(screen.getByText("Runs and work items")).toBeInTheDocument();
      expect(screen.getByText("Need to stop run")).toBeInTheDocument();
      expect(screen.getAllByText(/Stop task/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/inmediato, sin confirmación/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Work item looks stuck")).toBeInTheDocument();
      expect(screen.getByText(/A menudo esperando a persona, no fallando/)).toBeInTheDocument();
      expect(screen.getAllByText(/View agent/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("No pull request")).toBeInTheDocument();
      expect(screen.getByText(/Implement agent enabled/)).toBeInTheDocument();
    });
    it("renders Runs table has Síntoma/Fix header and 3 rows", () => {
      render(React.createElement(TroubleshootingPage));
      const table = screen.getByLabelText("Runs and work items troubleshooting table");
      const headers = within(table).getAllByRole("columnheader");
      expect(headers.map((h) => h.textContent)).toEqual(["Síntoma", "Fix"]);
      expect(within(table).getAllByRole("row")).toHaveLength(4); // header +3
    });
    it("renders exact routing hints factory:<alias> and @warp-factory and app_mention+message_posted", () => {
      render(React.createElement(TroubleshootingPage));
      expect(screen.getAllByText(/factory:<alias>/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/@warp-factory/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/app_mention/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/message_posted/).length).toBeGreaterThanOrEqual(1);
    });
    it("page has no console.log in source (static, no debug)", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const pagePath = path.resolve("src/components/help/TroubleshootingPage.tsx");
      const content = fs.readFileSync(pagePath, "utf8");
      expect(content).not.toMatch(/console\.log\(/);
      const dataPath = path.resolve("src/lib/factory/domain/troubleshooting.data.ts");
      const dataContent = fs.readFileSync(dataPath, "utf8");
      expect(dataContent).not.toMatch(/console\.log\(/);
    });
    it("page does not import store (DIP, static)", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const content = fs.readFileSync(path.resolve("src/components/help/TroubleshootingPage.tsx"), "utf8");
      expect(content).not.toMatch(/useWorkItems|WorkItemStore|getWorkItemStore/);
    });
    it("renders 100-forms smoke: all expected strings appear together", () => {
      render(React.createElement(TroubleshootingPage));
      const allText = document.body.textContent ?? "";
      const mustContain = [
        "Don't have access",
        "Repo no aparece en picker",
        "Setup stops at agent limit",
        "Web app sigue mostrando setup wizard",
        "Casi siempre es automation mismatch",
        "Slack",
        "GitHub",
        "GitLab",
        "Linear",
        "Jira",
        "App isn't in channel",
        "factory:<alias>",
        "single filter mismatch",
        "Mention es edit no new comment",
        "Premium/Ultimate",
        "agent_session_created",
        "Warp app no conectada",
        "app_mention",
        "message_posted",
        "angostar/remover overlapping",
        "Need to stop run",
        "inmediato, sin confirmación",
        "Work item looks stuck",
        "esperando a persona",
        "View agent",
        "steer si activo",
        "No pull request",
        "Implement agent enabled",
        "branch protection aplica",
      ];
      for (const phrase of mustContain) {
        expect(allText, `missing phrase: ${phrase}`).toContain(phrase);
      }
    });
  });

  describe("escalabilidad — OCP: agregar sección no rompe existentes", () => {
    it("adding new Setup row would be OCP-safe: length check parametrized", () => {
      // Ensures future rows don't silently drop exact names
      expect(SETUP_ROWS.length).toBeGreaterThanOrEqual(4);
      expect(RUNS_ROWS.length).toBeGreaterThanOrEqual(3);
      expect(WORK_SOURCES.length).toBeGreaterThanOrEqual(5);
    });
  });
});
