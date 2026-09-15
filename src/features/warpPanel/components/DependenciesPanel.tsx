/**
 * DependenciesPanel — main-area view for machine-global factory tools
 * (pr-agent CLI). Opened from the Dependencies nav item in the left panel.
 *
 * - Presentational: network goes through `factoryClient` ops (never throw);
 *   parsing is tolerant (unknown shapes render honest-empty).
 * - ZERO polling: loads on mount plus manual Re-check. Install is an
 *   explicit human action (long timeout); its log tail renders in the
 *   terminal pane below, like a run transcript (read-only, not a pty).
 * - Fail-safe: daemon unreachable renders a gray notice, never a crash.
 * - pr-agent is machine-global (uv/pip), never per-project: one install
 *   serves every repo. python/gh render as info rows (managed outside).
 *
 * ESM only, zero `require()`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { discoverFactoryPort } from "@/lib/factoryDiscovery";
import {
  getFactoryDependenciesStatus,
  postFactoryPrAgentInstall,
  type FactoryDependencyTool,
} from "@/lib/factoryClient";
import { IconCopy, IconRefresh } from "./warpIcons";

function toolByName(tools: FactoryDependencyTool[], name: string): FactoryDependencyTool | null {
  try {
    return tools.find((t) => t.name === name) ?? null;
  } catch {
    return null;
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
  const [installing, setInstalling] = useState(false);
  const [tools, setTools] = useState<FactoryDependencyTool[]>([]);
  const [unreachable, setUnreachable] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

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
      if (copyTimer.current !== null) {
        try {
          window.clearTimeout(copyTimer.current);
        } catch {
          // noop
        }
        copyTimer.current = null;
      }
    };
  }, [refresh]);

  const prAgent = toolByName(tools, "pr-agent");
  const rest = tools.filter((t) => t.name !== "pr-agent");
  const command = prAgent?.installCommand ?? "pr-agent --version";

  const handleCopy = useCallback(async () => {
    const ok = await copyText(command);
    if (!ok) return;
    setCopied(true);
    if (copyTimer.current !== null) {
      try {
        window.clearTimeout(copyTimer.current);
      } catch {
        // noop
      }
    }
    try {
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // noop
    }
  }, [command]);

  const handleInstall = useCallback(async () => {
    if (installing || loading) return;
    setInstalling(true);
    setLog(`$ ${command}\n…running (up to ~10 min, machine-global install)…`);
    try {
      const port = await discoverFactoryPort();
      if (port === null) {
        setLog("factory unreachable — start the daemon and press Re-check.");
        return;
      }
      const res = await postFactoryPrAgentInstall({ port });
      if (!res.ok) {
        setLog(`$ ${command}\n${res.error ?? "install request failed"}`);
        return;
      }
      const data = res.data;
      if (data.ok) {
        setLog(`$ ${command}\n${data.log ?? `installed (v${data.version ?? "?"})`}`);
      } else {
        setLog(`$ ${command}\n${data.error ?? "install failed"}\n${data.log ?? ""}`.trimEnd());
      }
    } catch (e) {
      setLog(`$ ${command}\n${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInstalling(false);
      await refresh();
    }
  }, [command, installing, loading, refresh]);

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
              Factory unreachable — start the daemon, then Re-check.
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
            {/* pr-agent card */}
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
                  pr-agent
                  {prAgent?.installed && prAgent.version ? (
                    <span style={{ color: "var(--wp-text-disabled)", fontWeight: 400 }}>
                      {" "}v{prAgent.version}
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
                    color: prAgent?.installed ? "#4ade80" : "#fbbf24",
                    background: prAgent?.installed ? "#22c55e22" : "#f59e0b22",
                    border: `1px solid ${prAgent?.installed ? "#22c55e55" : "#f59e0b55"}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: prAgent?.installed ? "#4ade80" : "#fbbf24",
                    }}
                  />
                  {prAgent?.installed ? "Installed" : "Missing"}
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
                External PR reviewer used by the factory after opening a PR.
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                {prAgent && !prAgent.installed && prAgent.installable ? (
                  <button
                    onClick={handleInstall}
                    disabled={installing}
                    aria-label="Install pr-agent"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontFamily: "var(--wp-font-mono)",
                      fontSize: 11,
                      padding: "5px 10px",
                      borderRadius: 4,
                      border: "1px solid var(--wp-border)",
                      background: installing ? "transparent" : "var(--wp-accent-dim)",
                      color: "var(--wp-text-primary)",
                      cursor: installing ? "wait" : "pointer",
                      opacity: installing ? 0.7 : 1,
                    }}
                  >
                    {installing ? "Installing…" : "Install"}
                  </button>
                ) : null}
                <button
                  onClick={() => void refresh()}
                  disabled={loading || installing}
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
                    cursor: loading || installing ? "wait" : "pointer",
                    opacity: loading || installing ? 0.7 : 1,
                  }}
                >
                  <IconRefresh size={11} />
                  Re-check
                </button>
              </div>

              {/* Command box + copy */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  border: "1px solid var(--wp-border)",
                  borderRadius: 4,
                  background: "#0d0d0d",
                  padding: "6px 8px",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--wp-font-mono)",
                    fontSize: 11,
                    color: "var(--wp-text-secondary)",
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={command}
                >
                  {command}
                </span>
                <button
                  onClick={() => void handleCopy()}
                  aria-label={copied ? "Copied" : "Copy command"}
                  title={copied ? "Copied" : "Copy command"}
                  style={{
                    display: "flex",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: copied ? "#4ade80" : "var(--wp-text-disabled)",
                    padding: 2,
                    flexShrink: 0,
                  }}
                >
                  <IconCopy size={12} />
                </button>
              </div>

              {/* Terminal pane (read-only transcript) */}
              <div
                aria-label="Install output"
                style={{
                  border: "1px solid var(--wp-border)",
                  borderRadius: 4,
                  background: "#0d0d0d",
                  padding: "8px",
                  maxHeight: 220,
                  overflowY: "auto",
                }}
              >
                <pre
                  style={{
                    margin: 0,
                    fontFamily: "var(--wp-font-mono)",
                    fontSize: 11,
                    lineHeight: 1.55,
                    color: "var(--wp-text-secondary)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {log ?? "Press Install to run the command."}
                </pre>
              </div>

              {prAgent?.hint ? (
                <div
                  style={{
                    fontFamily: "var(--wp-font-mono)",
                    fontSize: 11,
                    lineHeight: 1.5,
                    color: "var(--wp-text-disabled)",
                  }}
                >
                  {prAgent.hint}
                </div>
              ) : null}
            </div>

            {/* info rows: python / gh */}
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
