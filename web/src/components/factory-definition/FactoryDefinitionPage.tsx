// SRP: Factory definition viewer — lists files from bundle, shows detail via FileViewer, validation mock, mode-aware banners
// DIP: reads FactoryBundle via useFactoryBundle; derive via factory.definition.derive (pura)

import { useMemo, useState } from "react";
import { useFactoryBundle } from "../../lib/factory/hooks/useFactoryBundle";
import {
  SAMPLE_AGENT_FOREMAN,
  SAMPLE_AGENT_REVIEWER,
  SAMPLE_AUTOMATION_LABELED,
  SAMPLE_FACTORY_FULL,
  SAMPLE_RUNNER_LINUX,
  SAMPLE_RUNNER_MAC,
  SAMPLE_SCORER_TESTS,
} from "../../lib/factory/fixtures/samples";
import {
  deriveDefinitionFiles,
  githubFileUrl,
  getDefinitionVisibility,
  mockWarpFactoryConfig,
} from "../../lib/factory/domain/factory.definition.derive";
import type { DefinitionMode, DefinitionFile } from "../../lib/factory/domain/factory.definition.derive";
import { FileViewer } from "./FileViewer";

// Provide rawMap for accurate syntax render — uses same samples as bundle source
const RAW_MAP: Record<string, string> = {
  "factory.yaml": SAMPLE_FACTORY_FULL,
  "agents/foreman/agent.md": SAMPLE_AGENT_FOREMAN,
  "agents/reviewer/agent.md": SAMPLE_AGENT_REVIEWER,
  "automations/labeled-issue/automation.md": SAMPLE_AUTOMATION_LABELED,
  "runners/linux-build.yaml": SAMPLE_RUNNER_LINUX,
  "runners/mac.yaml": SAMPLE_RUNNER_MAC,
  "scorers/tests-run/scorer.md": SAMPLE_SCORER_TESTS,
  "skills/repository-conventions/SKILL.md": `---
name: repository-conventions
description: Factory-wide skill — available to all agents
---

# Repository Conventions

All agents follow this repository's standards. Factory-wide = skills/<name>/SKILL.md (available to todos los agents).`,
  "agents/foreman/skills/incident-triage/SKILL.md": `---
name: incident-triage
description: Per-agent skill — only foreman
---

# Incident Triage

Only foreman. Specialized procedure for incident handling.`,
};

export interface FactoryDefinitionPageProps {
  mode?: DefinitionMode;
}

function SkillsNote() {
  return (
    <div className="rounded-[8px] border border-dashed border-zinc-300 bg-white px-3 py-2 text-[11px] leading-relaxed text-zinc-600">
      <span className="font-medium text-zinc-700">skills/</span> = factory-wide (todos los agents) · <span className="font-medium text-zinc-700">agents/&lt;name&gt;/skills/</span> = solo ese agente. Mismo formato SKILL.md. Ver WarpFactories.md §5.
    </div>
  );
}

export function FactoryDefinitionPage({ mode = "warp-managed" }: FactoryDefinitionPageProps) {
  const res = useFactoryBundle();
  const bundle = res.ok ? res.value! : null;
  const visibility = getDefinitionVisibility(mode);

  const files: DefinitionFile[] = useMemo(() => {
    if (!bundle) return [];
    return deriveDefinitionFiles(bundle, RAW_MAP);
  }, [bundle]);

  const [selectedPath, setSelectedPath] = useState<string>("factory.yaml");

  const selected = files.find((f) => f.path === selectedPath) ?? files[0];
  const issues = useMemo(() => (bundle ? mockWarpFactoryConfig(bundle, RAW_MAP) : []), [bundle]);
  const primaryRepo = bundle?.factory.repositories[0] ?? { owner: "acme", name: "payments-service" };
  const [requestOpen, setRequestOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);

  if (!bundle) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-zinc-500">Bundle failed — check definition validation</p>
      </div>
    );
  }

  // Live-managed: no files
  if (mode === "live-managed") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-canvas p-4">
        <div className="mx-auto w-full max-w-[880px]">
          <h2 className="text-[18px] font-[650] tracking-[-0.02em] text-zinc-900">Factory definition</h2>
          <p className="mt-1 text-[12px] text-zinc-500">WarpFactories.md §7 Definitions as Code + §10 Factory definition tab</p>
          <div className="mt-4 rounded-[12px] border border-zinc-200 bg-white p-6 text-center">
            <p className="text-[13px] font-medium text-zinc-700">Live-managed — no definition files (API)</p>
            <p className="mt-1 text-[11px] text-zinc-500">Manejada vía Factory API. Factory definition tab no existe.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-canvas">
      {/* File list */}
      <div className="flex w-[300px] shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-3 py-2.5">
          <h2 className="text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">Factory definition</h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">{files.length} files · {mode} · WarpFactories.md §7</p>
          {mode === "github-backed" && (
            <div className="mt-2 rounded-[8px] border border-amber-200 bg-amber-50 px-2.5 py-2">
              <p className="text-[11px] font-medium text-amber-800">managed in GitHub, edit via PR — read-only en dashboard</p>
              <p className="mt-0.5 text-[11px] text-zinc-600">Link file+line al repo · `warp/factory-config` annota file+line</p>
            </div>
          )}
          {mode === "warp-managed" && (
            <div className="mt-1.5 rounded-[8px] border border-emerald-200 bg-emerald-50 px-2.5 py-1.5">
              <p className="text-[11px] font-[600] text-emerald-800">LOCAL — warp-managed (default)</p>
              <p className="text-[11px] leading-snug text-emerald-700">Editable · valida al guardar + commit atómico en un paso · nunca queda en estado inválido (§7). En LOCAL es solo lectura con simulación atómica en ValidationPage.</p>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          <ul className="space-y-1">
            {files.map((f) => {
              const isActive = selected?.path === f.path;
              const kindLabel = f.kind === "factory" ? "factory.yaml" : f.kind;
              return (
                <li key={f.path}>
                  <button
                    onClick={() => setSelectedPath(f.path)}
                    className={[
                      "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12px]",
                      isActive ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100",
                    ].join(" ")}
                  >
                    <span className={["rounded px-1 py-0.5 text-[10px] font-medium", isActive ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-600"].join(" ")}>
                      {kindLabel}
                    </span>
                    <span className="truncate font-mono text-[11px]">{f.path}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-3">
            <SkillsNote />
          </div>
          <div className="mt-3 rounded-[8px] border border-zinc-200 bg-zinc-50 p-2">
            <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Estructura §7</div>
            <div className="mt-1 font-mono text-[11px] leading-relaxed text-zinc-600">
              factory.yaml<br />
              agents/&lt;name&gt;/agent.md (frontmatter+body)<br />
              automations/&lt;name&gt;/automation.md<br />
              runners/*.yaml<br />
              scorers/*.md<br />
              skills/ (factory-wide + per-agent)
            </div>
            <div className="mt-1 text-[11px] text-zinc-400">paths: agents/foreman/agent.md etc. — file+line en warp/factory-config</div>
          </div>
        </div>

        {/* Validation mock */}
        <div className="border-t border-zinc-200 p-2">
          <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-2.5 py-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-[11px] font-[600] text-zinc-700">warp/factory-config</span>
              <span className="ml-auto text-[11px] text-zinc-500">mock</span>
            </div>
            {issues.length === 0 ? (
              <p className="mt-1 text-[11px] text-emerald-700">✓ valid — qué aplicaría: all files committed atómicamente</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {issues.map((iss, i) => (
                  <li key={i} className="font-mono text-[11px] text-red-600">
                    {iss.file}:{iss.line} — {iss.message}
                    {mode === "github-backed" && (
                      <a
                        href={githubFileUrl(primaryRepo.owner, primaryRepo.name, iss.file, iss.line)}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="ml-1 font-sans text-violet-600 hover:underline"
                      >
                        ↗ GitHub
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-[10px] text-zinc-400">Cada PR contra main recibe check warp/factory-config: annota fields inválidos y refs con file+line, resume qué aplicaría.</p>
          </div>

          {/* Warp-managed flow stubs */}
          {visibility.editable && (
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => setRequestOpen((v) => !v)}
                className="flex-1 rounded-[8px] border border-zinc-200 bg-white px-2 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Request changes
              </button>
              <button
                onClick={() => setApproveOpen((v) => !v)}
                className="flex-1 rounded-[8px] bg-zinc-900 px-2 py-1.5 text-[11px] font-medium text-white hover:bg-zinc-800"
              >
                Approve & merge
              </button>
            </div>
          )}
          {requestOpen && <p className="mt-1 text-[11px] text-zinc-500">stub: feedback al agent (Warp-managed flow §10)</p>}
          {approveOpen && <p className="mt-1 text-[11px] text-zinc-500">stub: commit atómico aplicado — nunca queda en estado inválido</p>}
        </div>
      </div>

      {/* Detail */}
      <div className="flex min-h-0 flex-1 flex-col p-3">
        {selected ? (
          <FileViewer
            path={selected.path}
            raw={selected.raw}
            language={selected.language}
            readOnly={visibility.readOnly}
            githubUrl={
              mode === "github-backed"
                ? githubFileUrl(primaryRepo.owner, primaryRepo.name, selected.path, 1)
                : undefined
            }
          />
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-[12px] border border-dashed border-zinc-300 bg-white p-6">
            <p className="text-sm text-zinc-500">Select a file</p>
          </div>
        )}
        {selected && mode === "github-backed" && (
          <div className="mt-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-zinc-700">
            <span className="font-medium">managed in GitHub, edit via PR</span> —{" "}
            <a
              href={githubFileUrl(primaryRepo.owner, primaryRepo.name, selected.path, 7)}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-violet-600 hover:underline"
            >
              {selected.path}#L7 ↗
            </a>{" "}
            (file+line example)
          </div>
        )}
      </div>
    </div>
  );
}
