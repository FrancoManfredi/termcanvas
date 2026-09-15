import { useCallback, useEffect, useState } from "react";
import type { FactoryMcpBundleListItem } from "../../../lib/factoryClient";
import type { AgentsActionResult } from "../hooks/useAgents";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * McpEditorDialog — alta/edición de un bundle `factory/mcps/<name>.json`.
 *
 * Un bundle puede declarar varios servers; este editor gestiona el primero y
 * preserva el resto tal cual (v1: la forma cómoda es 1 bundle = 1 server).
 * Transporte remoto (url + headers) o local (command + args + env). Los
 * secretos van por env con placeholders documentados, no en el form.
 */

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parsePairs(text: string): { value: Record<string, string> } | { error: string } {
  const out: Record<string, string> = {};
  for (const line of parseLines(text)) {
    const eq = line.indexOf("=");
    if (eq <= 0) return { error: `Invalid line (use KEY=value): ${line.slice(0, 60)}` };
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!key) return { error: `Empty key in line: ${line.slice(0, 60)}` };
    out[key] = value;
  }
  return { value: out };
}

function toLines(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export interface McpEditorDialogProps {
  bundle: FactoryMcpBundleListItem | null;
  loadMcp: (name: string) => Promise<AgentsActionResult & { servers?: Record<string, unknown> }>;
  addMcp: (name: string, servers: Record<string, unknown>) => Promise<AgentsActionResult>;
  updateMcp: (name: string, servers: Record<string, unknown>) => Promise<AgentsActionResult>;
  removeMcp: (name: string) => Promise<AgentsActionResult>;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function McpEditorDialog({
  bundle,
  loadMcp,
  addMcp,
  updateMcp,
  removeMcp,
  onClose,
  onDone,
}: McpEditorDialogProps) {
  const isEdit = bundle !== null;
  const [name, setName] = useState(bundle?.name ?? "");
  const [serverName, setServerName] = useState(bundle?.name ?? "");
  const [transport, setTransport] = useState<"remote" | "local">("remote");
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [command, setCommand] = useState("npx");
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("");
  const [otherServers, setOtherServers] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(isEdit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!isEdit || bundle === null) return;
    let cancelled = false;
    void (async () => {
      const res = await loadMcp(bundle.name);
      if (cancelled) return;
      if (!res.ok || !res.servers) {
        setError(res.error ?? "Could not read the MCP bundle.");
        setLoading(false);
        return;
      }
      const entries = Object.entries(res.servers);
      const first = entries[0];
      if (first) {
        const [sName, sRaw] = first;
        const entry = (sRaw ?? {}) as Record<string, unknown>;
        setServerName(sName);
        if (typeof entry.url === "string") {
          setTransport("remote");
          setUrl(entry.url);
          const headers = (entry.headers ?? {}) as Record<string, string>;
          setHeadersText(toLines(headers));
        } else {
          setTransport("local");
          setCommand(typeof entry.command === "string" ? entry.command : "npx");
          const args = Array.isArray(entry.args) ? (entry.args as unknown[]).map(String) : [];
          setArgsText(args.join("\n"));
          const env = (entry.env ?? {}) as Record<string, string>;
          setEnvText(toLines(env));
        }
      }
      setOtherServers(Object.fromEntries(entries.slice(1)));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [bundle, isEdit, loadMcp]);

  const handleSave = useCallback(async () => {
    setError(null);
    const cleanName = name.trim();
    const cleanServer = serverName.trim() || cleanName;
    if (!NAME_PATTERN.test(cleanName) || cleanName.length > 64) {
      setError("Bundle name must be [a-z0-9_-], max 64 chars.");
      return;
    }
    if (!NAME_PATTERN.test(cleanServer) || cleanServer.length > 64) {
      setError("Server name must be [a-z0-9_-], max 64 chars.");
      return;
    }
    let entry: Record<string, unknown>;
    if (transport === "remote") {
      if (!url.trim()) {
        setError("Remote MCP requires a URL.");
        return;
      }
      entry = { url: url.trim() };
      if (headersText.trim()) {
        const parsed = parsePairs(headersText);
        if ("error" in parsed) {
          setError(parsed.error);
          return;
        }
        if (Object.keys(parsed.value).length > 0) entry.headers = parsed.value;
      }
    } else {
      if (!command.trim()) {
        setError("Local MCP requires a command.");
        return;
      }
      entry = { command: command.trim() };
      const args = parseLines(argsText);
      if (args.length > 0) entry.args = args;
      if (envText.trim()) {
        const parsed = parsePairs(envText);
        if ("error" in parsed) {
          setError(parsed.error);
          return;
        }
        if (Object.keys(parsed.value).length > 0) entry.env = parsed.value;
      }
    }
    const servers = { ...otherServers, [cleanServer]: entry };
    setBusy(true);
    const res = isEdit ? await updateMcp(cleanName, servers) : await addMcp(cleanName, servers);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not save the MCP bundle.");
      return;
    }
    onDone(
      isEdit
        ? "MCP saved. Agents using it pick it up on their next run."
        : "MCP created. Assign it to agents from their detail panel.",
    );
  }, [
    addMcp,
    argsText,
    command,
    envText,
    headersText,
    isEdit,
    name,
    otherServers,
    serverName,
    transport,
    updateMcp,
    url,
    onDone,
  ]);

  const handleDelete = useCallback(async () => {
    if (bundle === null) return;
    setBusy(true);
    setError(null);
    const res = await removeMcp(bundle.name);
    setBusy(false);
    if (!res.ok) {
      setConfirmDelete(false);
      setError(res.error ?? "Could not delete the MCP bundle.");
      return;
    }
    onDone("MCP deleted.");
  }, [bundle, removeMcp, onDone]);

  return (
    <>
      <div
        className="ag-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) onClose();
        }}
      >
        <div className="ag-dialog" role="dialog" aria-modal="true" aria-label={isEdit ? `Edit MCP ${name}` : "New MCP"}>
          <h2 className="ag-dialog-title">{isEdit ? `Edit MCP: ${bundle?.name}` : "New MCP bundle"}</h2>
          <p className="ag-section-hint">
            Stored at <code>factory/mcps/&lt;name&gt;.json</code>. Agents that
            declare it receive the server on their next run. Secrets belong in
            environment variables, not in this form.
          </p>

          {loading ? (
            <p className="ag-hint">Loading MCP...</p>
          ) : (
            <>
              <div className="ag-row-fields">
                <div className="ag-field">
                  <label className="ag-label" htmlFor="ag-mcp-name">
                    Bundle name
                  </label>
                  <input
                    id="ag-mcp-name"
                    className="ag-input"
                    value={name}
                    disabled={isEdit || busy}
                    placeholder="github"
                    spellCheck={false}
                    onChange={(event) => {
                      setName(event.target.value);
                      if (!isEdit) setServerName(event.target.value);
                    }}
                  />
                </div>
                <div className="ag-field">
                  <label className="ag-label" htmlFor="ag-mcp-server">
                    Server name
                  </label>
                  <input
                    id="ag-mcp-server"
                    className="ag-input"
                    value={serverName}
                    disabled={busy}
                    placeholder="github"
                    spellCheck={false}
                    onChange={(event) => setServerName(event.target.value)}
                  />
                </div>
              </div>

              <div className="ag-field">
                <span className="ag-label">Transport</span>
                <div className="ag-chips" role="radiogroup" aria-label="Transport">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={transport === "remote"}
                    className="ag-chip"
                    aria-pressed={transport === "remote"}
                    onClick={() => setTransport("remote")}
                  >
                    remote (url)
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={transport === "local"}
                    className="ag-chip"
                    aria-pressed={transport === "local"}
                    onClick={() => setTransport("local")}
                  >
                    local (command)
                  </button>
                </div>
              </div>

              {transport === "remote" ? (
                <>
                  <div className="ag-field">
                    <label className="ag-label" htmlFor="ag-mcp-url">
                      URL
                    </label>
                    <input
                      id="ag-mcp-url"
                      className="ag-input"
                      value={url}
                      disabled={busy}
                      placeholder="https://example.com/mcp"
                      spellCheck={false}
                      onChange={(event) => setUrl(event.target.value)}
                    />
                  </div>
                  <div className="ag-field">
                    <label className="ag-label" htmlFor="ag-mcp-headers">
                      Headers (one KEY=value per line, optional)
                    </label>
                    <textarea
                      id="ag-mcp-headers"
                      className="ag-textarea"
                      rows={3}
                      value={headersText}
                      disabled={busy}
                      placeholder={"Authorization=Bearer ${TOKEN}"}
                      onChange={(event) => setHeadersText(event.target.value)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="ag-row-fields">
                    <div className="ag-field">
                      <label className="ag-label" htmlFor="ag-mcp-command">
                        Command
                      </label>
                      <input
                        id="ag-mcp-command"
                        className="ag-input"
                        value={command}
                        disabled={busy}
                        placeholder="npx"
                        spellCheck={false}
                        onChange={(event) => setCommand(event.target.value)}
                      />
                    </div>
                    <div className="ag-field">
                      <label className="ag-label" htmlFor="ag-mcp-args">
                        Args (one per line)
                      </label>
                      <textarea
                        id="ag-mcp-args"
                        className="ag-textarea"
                        rows={3}
                        value={argsText}
                        disabled={busy}
                        placeholder={"-y\n@modelcontextprotocol/server-filesystem\n{projectPath}"}
                        onChange={(event) => setArgsText(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="ag-field">
                    <label className="ag-label" htmlFor="ag-mcp-env">
                      Env (one KEY=value per line, optional)
                    </label>
                    <textarea
                      id="ag-mcp-env"
                      className="ag-textarea"
                      rows={3}
                      value={envText}
                      disabled={busy}
                      placeholder={"GITHUB_TOKEN=${GITHUB_TOKEN}"}
                      onChange={(event) => setEnvText(event.target.value)}
                    />
                  </div>
                </>
              )}

              {Object.keys(otherServers).length > 0 ? (
                <p className="ag-hint">
                  This bundle declares {Object.keys(otherServers).length} extra
                  server(s): {Object.keys(otherServers).join(", ")}. They are
                  preserved untouched.
                </p>
              ) : null}

              {error ? (
                <p className="ag-hint ag-hint--error" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          )}

          <div className="ag-dialog-actions" style={{ marginTop: 16 }}>
            {isEdit ? (
              <button
                type="button"
                className="ag-btn ag-btn--danger"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                style={{ marginRight: "auto" }}
              >
                Delete MCP
              </button>
            ) : null}
            <button type="button" className="ag-btn ag-btn--ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="ag-btn ag-btn--primary"
              onClick={() => void handleSave()}
              disabled={busy || loading}
            >
              {busy ? "Saving..." : isEdit ? "Save MCP" : "Create MCP"}
            </button>
          </div>
        </div>
      </div>
      {confirmDelete && bundle !== null ? (
        <ConfirmDialog
          title={`Delete MCP "${bundle.name}"?`}
          body="Agents that still reference it will fail on their next run until it is recreated or removed from their frontmatter."
          confirmLabel="Delete MCP"
          danger
          busy={busy}
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </>
  );
}
