/**
 * DependenciesPanel — main-area view for machine-global factory tools.
 * Opened from the Dependencies nav item in the left panel.
 *
 * - Presentational: network goes through `factoryClient` ops (never throw);
 *   parsing is tolerant (unknown shapes render honest-empty).
 * - ZERO polling: loads on mount plus manual Re-check.
 * - Fail-safe: daemon unreachable renders a gray notice, never a crash.
 * - This panelGUIDES, it never installs: the runner + Pullfrog cards
 *   below are step-by-step instructions with copy buttons. The human
 *   runs every command in their own terminal with their own secrets —
 *   nothing here asks for, stores, or sends any token, ever.
 * - The only live data is the read-only runners list (names + online
 *   status, zero secrets) used to verify a manual install worked.
 * - python/gh render as info rows (managed outside).
 *
 * ESM only, zero `require()`.
 */

import { useCallback, useEffect, useState } from "react";
import { discoverFactoryPort } from "@/lib/factoryDiscovery";
import {
  getFactoryDependenciesStatus,
  getFactoryRunnersStatus,
  type FactoryDependencyTool,
  type FactoryRunnersStatus,
} from "@/lib/factoryClient";
import { IconRefresh } from "./warpIcons";

const RUNNERS_REPO_STORAGE_KEY = "warp-runners-repo-v1";
const RUNNERS_FOLDER_STORAGE_KEY = "warp-runners-folder-v1";
const RUNNERS_DEFAULT_FOLDER = "C:\\actions-runner";

function loadStored(key: string): string {
  try {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") return "";
    const raw = window.localStorage.getItem(key);
    return typeof raw === "string" ? raw : "";
  } catch {
    return "";
  }
}

function storeValue(key: string, value: string): void {
  try {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch {
    // Storage failure never breaks the panel.
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function DependenciesPanel(): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [tools, setTools] = useState<FactoryDependencyTool[]>([]);
  const [unreachable, setUnreachable] = useState(false);

  // Guide state. Repo/folder persist (non-secret); no token exists
  // anywhere in this panel by design.
  const [runnerRepo, setRunnerRepo] = useState(() => loadStored(RUNNERS_REPO_STORAGE_KEY));
  const [runnerFolder, setRunnerFolder] = useState(
    () => loadStored(RUNNERS_FOLDER_STORAGE_KEY) || RUNNERS_DEFAULT_FOLDER,
  );
  const [runners, setRunners] = useState<FactoryRunnersStatus | null>(null);
  const [runnersLoading, setRunnersLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const port = await discoverFactoryPort();
      if (port === null) {
        setUnreachable(true);
        setTools([]);
        return;
      }
      const res = await getFactoryDependenciesStatus({ port });
      if (!res.ok) {
        setUnreachable(true);
        setTools([]);
        return;
      }
      setUnreachable(false);
      setTools(Array.isArray(res.data.tools) ? res.data.tools : []);
    } catch {
      setUnreachable(true);
      setTools([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const refreshRunners = useCallback(async (repo: string, folder: string) => {
    setRunnersLoading(true);
    try {
      const port = await discoverFactoryPort();
      if (port === null) {
        setRunners(null);
        return;
      }
      const trimmedRepo = repo.trim();
      const trimmedFolder = folder.trim();
      const res = await getFactoryRunnersStatus({
        port,
        repo: trimmedRepo,
        folder: trimmedFolder.length > 0 ? trimmedFolder : undefined,
      });
      setRunners(res.ok ? res.data : null);
    } catch {
      setRunners(null);
    } finally {
      setRunnersLoading(false);
    }
  }, []);

  useEffect(() => {
    // Mount-only load (explicit Re-check afterwards — no fetch per keystroke).
    void refreshRunners(loadStored(RUNNERS_REPO_STORAGE_KEY), loadStored(RUNNERS_FOLDER_STORAGE_KEY));
  }, [refreshRunners]);

  // All daemon rows render as info rows (python/gh).
  const rest = tools;

  const handleRunnerRepoChange = useCallback((value: string) => {
    setRunnerRepo(value);
    storeValue(RUNNERS_REPO_STORAGE_KEY, value);
  }, []);

  const handleRunnerFolderChange = useCallback((value: string) => {
    setRunnerFolder(value);
    storeValue(RUNNERS_FOLDER_STORAGE_KEY, value);
  }, []);

  const handleGuideCopy = useCallback(async (key: string, text: string) => {
    try {
      const ok = await copyText(text);
      if (!ok) return;
      setCopiedKey(key);
      try {
        window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1500);
      } catch {
        // noop
      }
    } catch {
      // copy best-effort
    }
  }, []);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: "20px 24px",
      }}
    >
      <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div
            style={{
              fontFamily: "var(--wp-font-mono)",
              fontSize: 15,
              fontWeight: 600,
              color: "var(--wp-text-primary)",
            }}
          >
            Dependencies
          </div>
          <div
            style={{
              fontFamily: "var(--wp-font-mono)",
              fontSize: 12,
              color: "var(--wp-text-secondary)",
              marginTop: 4,
            }}
          >
            Machine-global tools used by the factory. Installed once per machine — every repo
            shares them.
          </div>
        </div>

        {unreachable ? (
          <div
            style={{
              border: "1px solid var(--wp-border)",
              borderRadius: 6,
              background: "#161616",
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div
              style={{
                fontFamily: "var(--wp-font-mono)",
                fontSize: 12,
                color: "var(--wp-text-disabled)",
              }}
            >
              Factory unreachable — start the daemon (`node scripts/start-factory.mjs`
              or `pnpm dev:web-local`), then Re-check.
            </div>
            <div>
              <button
                onClick={() => void refresh()}
                disabled={loading}
                aria-label="Re-check dependencies"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "var(--wp-font-mono)",
                  fontSize: 11,
                  padding: "5px 10px",
                  borderRadius: 4,
                  border: "1px solid var(--wp-border)",
                  background: "transparent",
                  color: "var(--wp-text-secondary)",
                  cursor: loading ? "wait" : "pointer",
                  opacity: loading ? 0.7 : 1,
                }}
              >
                <IconRefresh size={11} />
                Re-check
              </button>
            </div>
          </div>
        ) : loading ? (
          <div
            style={{
              fontFamily: "var(--wp-font-mono)",
              fontSize: 12,
              color: "var(--wp-text-disabled)",
            }}
          >
            Checking…
          </div>
        ) : (
          <>
            {/* Step-by-step guides */}
            <GuideCard
              runners={runners}
              runnersLoading={runnersLoading}
              repo={runnerRepo}
              folder={runnerFolder}
              copiedKey={copiedKey}
              onRepoChange={handleRunnerRepoChange}
              onFolderChange={handleRunnerFolderChange}
              onRefresh={() => void refreshRunners(runnerRepo, runnerFolder)}
              onCopy={(key, text) => void handleGuideCopy(key, text)}
            />

            {/* info rows */}
            {rest.map((tool) => (
              <div
                key={tool.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  border: "1px solid var(--wp-border-subtle)",
                  borderRadius: 6,
                  padding: "8px 14px",
                }}
                title={tool.hint ?? tool.description}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: tool.installed ? "#22c55e" : "#6b7280",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontFamily: "var(--wp-font-mono)",
                    fontSize: 12,
                    color: "var(--wp-text-secondary)",
                    flex: 1,
                  }}
                >
                  {tool.name}
                  {tool.installed && tool.version ? ` v${tool.version}` : ""}
                  {!tool.installed && tool.hint ? ` — ${tool.hint}` : ""}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Guide card ───────────────────────────────────────────────────────────
// Static step-by-step guides (self-hosted runner + Pullfrog). No installs
// run from here on purpose: every command below is meant for the human's
// own terminal, with their own secrets. The only live data is the
// read-only runners list used to verify a manual install worked.

interface GuideCardProps {
  runners: FactoryRunnersStatus | null;
  runnersLoading: boolean;
  repo: string;
  folder: string;
  copiedKey: string | null;
  onRepoChange: (value: string) => void;
  onFolderChange: (value: string) => void;
  onRefresh: () => void;
  onCopy: (key: string, text: string) => void;
}

function GuideCard(props: GuideCardProps): React.JSX.Element {
  const { runners, runnersLoading } = props;
  const online = runners?.remote.runners.filter((r) => r.online) ?? [];
  const localReady = (runners?.local.configured ?? false) && (runners?.local.services.length ?? 0) > 0;
  const localInstalled = runners?.local.dirExists ?? false;
  const badge = localReady
    ? { text: "Ready", fg: "#4ade80", bg: "#22c55e22", border: "#22c55e55", dot: "#4ade80" }
    : localInstalled
      ? { text: "Installed", fg: "#4ade80", bg: "#22c55e22", border: "#22c55e55", dot: "#4ade80" }
      : { text: "Missing", fg: "#fbbf24", bg: "#f59e0b22", border: "#f59e0b55", dot: "#fbbf24" };
  const repoSlug = props.repo.trim().length > 0 ? props.repo.trim() : "<owner>/<repo>";
  const pinnedVersion = runners?.pinned.version ?? "";
  const smallBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "var(--wp-font-mono)",
    fontSize: 11,
    padding: "5px 10px",
    borderRadius: 4,
    border: "1px solid var(--wp-border)",
    background: "transparent",
    color: "var(--wp-text-secondary)",
    cursor: "pointer",
  };
  const field: React.CSSProperties = {
    width: "100%",
    fontFamily: "var(--wp-font-mono)",
    fontSize: 11,
    color: "var(--wp-text-primary)",
    background: "#0d0d0d",
    border: "1px solid var(--wp-border)",
    borderRadius: 4,
    padding: "6px 8px",
    outline: "none",
  };
  const label: React.CSSProperties = {
    fontFamily: "var(--wp-font-mono)",
    fontSize: 10,
    color: "var(--wp-text-disabled)",
    marginBottom: 2,
  };
  const stepText: React.CSSProperties = {
    fontFamily: "var(--wp-font-mono)",
    fontSize: 12,
    lineHeight: 1.55,
    color: "var(--wp-text-secondary)",
    flex: 1,
  };
  const codeBox: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid var(--wp-border)",
    borderRadius: 4,
    background: "#0d0d0d",
    padding: "6px 8px",
    marginTop: 4,
  };
  const codeText: React.CSSProperties = {
    fontFamily: "var(--wp-font-mono)",
    fontSize: 11,
    color: "var(--wp-text-secondary)",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  const copyBtn: React.CSSProperties = {
    display: "flex",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: 2,
    flexShrink: 0,
    fontFamily: "var(--wp-font-mono)",
    fontSize: 11,
  };
  const sectionTitle: React.CSSProperties = {
    fontFamily: "var(--wp-font-mono)",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--wp-text-primary)",
  };
  const copyFor = (key: string, text: string): React.JSX.Element => (
    <button
      onClick={() => props.onCopy(key, text)}
      aria-label={props.copiedKey === key ? "Copied" : "Copy"}
      title={props.copiedKey === key ? "Copied" : "Copy"}
      style={{ ...copyBtn, color: props.copiedKey === key ? "#4ade80" : "var(--wp-text-disabled)" }}
    >
      {props.copiedKey === key ? "Copied" : "Copy"}
    </button>
  );
  const stepRow = (n: number, body: React.JSX.Element): React.JSX.Element => (
    <div key={n} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: "1px solid var(--wp-border)",
          fontFamily: "var(--wp-font-mono)",
          fontSize: 10,
          color: "var(--wp-text-secondary)",
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {n}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>{body}</div>
    </div>
  );
  const configCmd = `.\\config.cmd --url https://github.com/${repoSlug} --token <TU_TOKEN> --unattended`;
  const svcCmd = `.\\svc.cmd install\n.\\svc.cmd start`;
  return (
    <div
      style={{
        border: "1px solid var(--wp-border)",
        borderRadius: 6,
        background: "#161616",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--wp-text-primary)",
            flex: 1,
          }}
        >
          Self-hosted runner — guía
          {pinnedVersion ? (
            <span style={{ color: "var(--wp-text-disabled)", fontWeight: 400 }}>
              {" "}v{pinnedVersion}
            </span>
          ) : null}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 10,
            color: badge.fg,
            background: badge.bg,
            border: `1px solid ${badge.border}`,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: badge.dot }} />
          {runners === null ? "Unknown" : badge.text}
        </span>
      </div>

      <div
        style={{
          fontFamily: "var(--wp-font-mono)",
          fontSize: 12,
          lineHeight: 1.5,
          color: "var(--wp-text-secondary)",
        }}
      >
        Instalación manual en cada PC (sin automatismos: los comandos se corren en tu terminal).{" "}
        {runners?.remote.reachable
          ? `${online.length} runner${online.length === 1 ? "" : "s"} online.`
          : "Lista remota no alcanzable — revisá gh auth y Re-check."}
      </div>

      {runners?.local.supervised ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--wp-font-mono)",
            fontSize: 11,
            color: "var(--wp-text-secondary)",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: runners.local.supervised.running ? "#22c55e" : "#6b7280",
              flexShrink: 0,
            }}
          />
          <span>
            {runners.local.supervised.running
              ? `Gestionado por la app: corriendo${runners.local.supervised.pid !== null ? ` (pid ${runners.local.supervised.pid})` : ""}`
              : `Gestionado por la app: detenido${runners.local.supervised.restarts > 0 ? ` (${runners.local.supervised.restarts} reinicios)` : ""}`}
          </span>
        </div>
      ) : null}

      {online.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {online.map((r) => (
            <div
              key={r.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontFamily: "var(--wp-font-mono)",
                fontSize: 11,
                color: "var(--wp-text-secondary)",
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: r.busy ? "#fbbf24" : "#22c55e",
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.name}
                {r.os ? ` — ${r.os}` : ""}
                {r.busy ? " (busy)" : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div>
          <div style={label}>Repo (owner/name)</div>
          <input
            value={props.repo}
            onChange={(e) => props.onRepoChange(e.target.value)}
            placeholder="owner/repo"
            spellCheck={false}
            aria-label="Runner repo"
            style={field}
          />
        </div>
        <div>
          <div style={label}>Carpeta en este PC (solo para el estado local)</div>
          <input
            value={props.folder}
            onChange={(e) => props.onFolderChange(e.target.value)}
            placeholder="C:\actions-runner"
            spellCheck={false}
            aria-label="Runner folder"
            style={field}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={props.onRefresh}
          disabled={runnersLoading}
          aria-label="Re-check runners"
          style={{
            ...smallBtn,
            cursor: runnersLoading ? "wait" : "pointer",
            opacity: runnersLoading ? 0.7 : 1,
          }}
        >
          <IconRefresh size={11} />
          Re-check
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {stepRow(
          1,
          <div style={stepText}>
            En GitHub: tu repo → Settings → Actions → Runners → New self-hosted runner → elegí Windows. Seguí la
            descarga y esos pasos ahí (carpeta recomendada <span style={{ color: "var(--wp-text-primary)" }}>C:\actions-runner</span>,
            fuera de OneDrive y de checkouts git).
          </div>,
        )}
        {stepRow(
          2,
          <div>
            <div style={stepText}>
              Cuando llegues a `# Run it!` y te pida la config, corre esto <em>antes</em> que `./run.cmd` (el token
              es el que te muestra esa misma página de GitHub; dura ~1 hora, uno por PC):
            </div>
            <div style={codeBox} title={configCmd}>
              <span style={codeText}>{configCmd}</span>
              {copyFor("config", configCmd)}
            </div>
          </div>,
        )}
        {stepRow(
          3,
          <div>
            <div style={stepText}>Después sí, `./run.cmd`. Para dejarlo fijo, en shell elevada:</div>
            <div style={codeBox} title={svcCmd}>
              <span style={{ ...codeText, whiteSpace: "pre-wrap" }}>{svcCmd}</span>
              {copyFor("svc", svcCmd)}
            </div>
          </div>,
        )}
        {stepRow(
          4,
          <div>
            <div style={stepText}>Apuntá pullfrog.yml a tu máquina:</div>
            <div style={codeBox} title="runs-on: [self-hosted, Windows, X64]">
              <span style={codeText}>runs-on: [self-hosted, Windows, X64]</span>
              {copyFor("runson", "runs-on: [self-hosted, Windows, X64]")}
            </div>
          </div>,
        )}
        {stepRow(
          5,
          <div style={stepText}>
            Verificá: Re-check acá (tu PC en verde + runner online) y un `@pullfrog` de prueba en un PR.
          </div>,
        )}
      </div>

      <div style={{ ...sectionTitle, marginTop: 2 }}>Pullfrog — guía</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {stepRow(
          1,
          <div style={stepText}>
            Consola Pullfrog: login con GitHub → instalar la App en el repo → crear `.github/workflows/pullfrog.yml`.
          </div>,
        )}
        {stepRow(
          2,
          <div style={stepText}>
            `OPENCODE_API_KEY` como secreto Pullfrog (Model usage) y modelo Big Pickle en Agent → Model.
          </div>,
        )}
        {stepRow(
          3,
          <div style={stepText}>
            Reviews: auto-review ON, re-review en push ON; approve, auto-merge y progress comments OFF (hasta ganar
            confianza).
          </div>,
        )}
        {stepRow(
          4,
          <div style={stepText}>
            Probar: comentario `@pullfrog` en un PR real y leer el review (summary + inline comments).
          </div>,
        )}
        {stepRow(
          5,
          <div style={stepText}>
            Después: branch protection con `pullfrog-approval` requerido y Fix 👍s sobre findings reales.
          </div>,
        )}
      </div>
    </div>
  );
}
