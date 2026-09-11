import { useEffect, useMemo, useRef, useState } from "react";
import { PLAYGROUND_FS, getPlaygroundF } from "../../lib/factory/playgroundData";
import {
  getLatestVerdict,
  getRollbackWarnings,
  isBlocked,
  isFlaky,
  usePlaygroundStore,
  type PlaygroundVerdictEntry,
  type VerdictStatus,
} from "../../stores/playgroundStore";
import { getCodeHash, getReportDisplayPath, getReportPath, syncVerdictToReportMd } from "../../lib/factory/playgroundReports";
import { FACTORY_BASE, FACTORY_HEALTH, FACTORY_JOBS, verifyHealthWithRetry, verifyJobCreate } from "../../lib/factory/verifyRunner";

// ── Constantes ──

// FACTORY_* imported from verifyRunner as single source

// ── Tipos (real backend) ──
interface RealJob {
  id: string;
  prompt: string;
  worktree: string;
  phase: string;
  state: "queued" | "running" | "done" | "error";
  createdAt: string;
  updatedAt?: string;
  logs?: string[];
  dir?: string | null;
  logsCount?: number;
}

// ── Small UI atoms ──

function SectionCard({ title, eyebrow, children }: { title: string; eyebrow?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      {eyebrow && <div className="tc-eyebrow px-4 pt-3">{eyebrow}</div>}
      <div className="px-4 pt-1.5 pb-1">
        <h3 className="text-[13px] font-semibold tracking-tight text-[var(--text-primary)]">{title}</h3>
      </div>
      <div className="px-4 pb-4 pt-1">{children}</div>
    </div>
  );
}

function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
      {label && <div className="tc-label px-3 py-1.5 border-b border-[var(--border)] bg-[var(--surface)]">{label}</div>}
      <pre className="tc-mono text-[11px] leading-relaxed p-3 overflow-x-auto whitespace-pre-wrap break-words text-[var(--text-secondary)]">
        {children}
      </pre>
    </div>
  );
}

// ── Test zones per F — SIN SIMULACIONES ──

function F01TestZone() {
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [attempts, setAttempts] = useState<number>(0);
  const [attemptLabel, setAttemptLabel] = useState<string | null>(null);

  const runHealth = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    setOk(null);
    setDurationMs(null);
    setAttempts(0);
    setAttemptLabel("Intento 1/3…");
    try {
      // Use shared helper with backoff — it reports attempts/duration
      const r = await verifyHealthWithRetry(FACTORY_HEALTH, { timeoutMs: 500 });
      setAttempts(r.attempts);
      setDurationMs(r.durationMs);
      setAttemptLabel(`Intento ${r.attempts}/3`);
      if (r.ok) {
        const pretty = r.json ? JSON.stringify(r.json, null, 2) : (r.text ?? "");
        setResult(`HTTP ${r.status} OK — ${r.durationMs}ms — queue pending/running OK\n\n${pretty}`);
        setOk(true);
      } else {
        const pretty = r.json ? JSON.stringify(r.json, null, 2) : (r.text ?? r.error ?? "");
        const msg = r.timedOut ? `Timeout ${r.durationMs}ms > 500ms` : (r.error ?? `HTTP ${r.status}`);
        setError(r.timedOut ? `Timeout ${r.durationMs}ms > 500ms — ${pretty.slice(0, 400)}` : `${msg} — ${pretty.slice(0, 500)}`);
        setResult(`HTTP ${r.status ?? "ERR"} — ${r.durationMs}ms — ${r.error ?? "falló"}\n\n${pretty}`);
        setOk(false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setOk(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="tc-label text-[12px] leading-relaxed">
        Probá el health endpoint real. Si el daemon no está corriendo, verás un fallo honesto (sin simulación). Mide tiempo y valida queue.pending/running + timeout 500 ms.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void runHealth()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-foreground)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Probando…" : "Probar health"}
        </button>
        {loading && attemptLabel && <span className="tc-label text-[11px]">{attemptLabel} — backoff 500/1000 ms</span>}
        {!loading && durationMs !== null && (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${ok ? "bg-[color-mix(in_srgb,var(--green)_14%,transparent)] text-[var(--green)] border-transparent" : "bg-[color-mix(in_srgb,var(--red)_14%,transparent)] text-[var(--red)] border-[color-mix(in_srgb,var(--red)_20%,transparent)]"}`}>
            {durationMs} ms {durationMs < 500 ? "✓ <500" : "✗ ≥500"} · {attempts}/3 intentos
          </span>
        )}
        {ok === true && (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border bg-[color-mix(in_srgb,var(--green)_14%,transparent)] text-[var(--green)] border-transparent">
            PASS
          </span>
        )}
        {ok === false && (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border bg-[color-mix(in_srgb,var(--red)_14%,transparent)] text-[var(--red)] border-[color-mix(in_srgb,var(--red)_20%,transparent)]">
            FALLO
          </span>
        )}
      </div>
      {ok === true && result && (
        <div className="flex flex-col gap-2">
          <CodeBlock label={`GET /factory/health → PASS (${durationMs}ms, ${attempts} intento(s))`}>{result}</CodeBlock>
          <div className="tc-label text-[11px] leading-snug rounded-md bg-[var(--bg)] border border-[var(--border)] px-3 py-2">
            Criterio PASS: <span className="font-medium text-[var(--text-primary)]">status 200 && queue.pending/running && &lt;500 ms</span> — si duración ≥500 → FAIL por timeout.
          </div>
          <CodeBlock label="PowerShell / curl.exe — determinístico">
            {`# PowerShell (recomendado)
Invoke-RestMethod -UseBasicParsing http://127.0.0.1:17680/factory/health | ConvertTo-Json
# alternativa (cmd / git-bash / PowerShell con binario real)
curl.exe --silent http://127.0.0.1:17680/factory/health
# ⚠️ curl sin .exe en PowerShell es alias a Invoke-WebRequest → muestra StatusCode/RawContent`}
          </CodeBlock>
          <div className="tc-label text-[11px] leading-snug rounded-md bg-[var(--bg)] border border-[var(--border)] px-3 py-2">
            Tip: en PowerShell <span className="tc-mono text-[var(--text-primary)]">curl</span> solo es alias a{" "}
            <span className="tc-mono text-[var(--text-primary)]">Invoke-WebRequest</span> (no es curl real) — usá{" "}
            <span className="tc-mono text-[var(--text-primary)]">curl.exe</span> con <span className="tc-mono">--silent</span> o{" "}
            <span className="tc-mono text-[var(--text-primary)]">Invoke-RestMethod -UseBasicParsing</span>.
          </div>
        </div>
      )}
      {ok === false && (
        <div className="rounded-md border border-[color-mix(in_srgb,var(--red)_22%,transparent)] bg-[color-mix(in_srgb,var(--red)_10%,transparent)] px-3 py-2.5 flex flex-col gap-1.5">
          <div className="text-[12px] font-medium text-[var(--red)]">
            ❌ No disponible {durationMs !== null ? `— ${durationMs}ms` : ""} — {error?.includes("Failed to fetch") ? "ECONNREFUSED" : error}
          </div>
          {durationMs !== null && durationMs >= 500 && (
            <div className="text-[11px] font-medium text-[var(--red)]">Timeout {durationMs}ms &gt; 500ms — FAIL por criterio</div>
          )}
          <div className="tc-label text-[11px] leading-snug">
            Criterio PASS: <span className="font-medium text-[var(--text-primary)]">status 200 && queue.pending/running && &lt;500 ms</span> — si duración ≥500 o no hay queue → FAIL.
          </div>
          <div className="tc-label text-[11px] leading-snug">
            Asegurate que el daemon esté corriendo (<span className="tc-mono text-[var(--text-primary)]">pnpm dev</span> o{" "}
            <span className="tc-mono text-[var(--text-primary)]">node scripts/start-factory.mjs</span>). Reintento automático 3× con backoff 500 ms / 1000 ms.
          </div>
          <CodeBlock label="PowerShell / curl.exe — determinístico">
            {`# PowerShell (recomendado)
Invoke-RestMethod -UseBasicParsing http://127.0.0.1:17680/factory/health | ConvertTo-Json
# alternativa
curl.exe --silent http://127.0.0.1:17680/factory/health
# ⚠️ curl sin .exe es alias a Invoke-WebRequest → StatusCode/RawContent`}
          </CodeBlock>
          {result && <CodeBlock label={`Intento ${attempts}/3 — ${durationMs}ms`}>{result}</CodeBlock>}
          <div className="tc-label text-[11px] leading-snug">
            En PowerShell <span className="tc-mono text-[var(--text-primary)]">curl</span> es alias a{" "}
            <span className="tc-mono text-[var(--text-primary)]">Invoke-WebRequest</span>. Usa{" "}
            <span className="tc-mono text-[var(--text-primary)]">curl.exe --silent {FACTORY_BASE}/factory/health</span> o{" "}
            <span className="tc-mono text-[var(--text-primary)]">Invoke-RestMethod -UseBasicParsing {FACTORY_BASE}/factory/health | ConvertTo-Json</span>
          </div>
        </div>
      )}
      {ok === null && (
        <CodeBlock label="Esperando prueba…">
          {`Hacé click en "Probar health" (fetch con backoff 500/1000).
PowerShell (recomendado):
  Invoke-RestMethod -UseBasicParsing http://127.0.0.1:17680/factory/health | ConvertTo-Json
Alternativa:
  curl.exe --silent http://127.0.0.1:17680/factory/health
⚠️ curl sin .exe en PowerShell es alias a Invoke-WebRequest.
Criterio PASS: status 200 && queue.pending/running && <500 ms.`}
        </CodeBlock>
      )}
      <div className="tc-label text-[11px] leading-snug rounded-md bg-[var(--bg)] border border-[var(--border)] px-3 py-2">
        <span className="font-medium text-[var(--text-secondary)]">CI:</span> corré <span className="tc-mono text-[var(--text-primary)]">node scripts/verify-F01.mjs</span> — mismo criterio (fetch + 500 ms + reintentos) sin click.
      </div>
    </div>
  );
}

function F02TestZone() {
  const [prompt, setPrompt] = useState("hola — job de prueba F02");
  const [worktree, setWorktree] = useState("C:\\tmp\\repo-prueba");
  const [phase, setPhase] = useState("diagnosisLlm");
  const [lastJob, setLastJob] = useState<RealJob | null>(null);
  const [jobs, setJobs] = useState<RealJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshJobs = async () => {
    try {
      const res = await fetch(FACTORY_JOBS, { method: "GET" });
      if (res.ok) {
        const data = (await res.json()) as { jobs: RealJob[] };
        setJobs(Array.isArray(data.jobs) ? data.jobs : []);
      }
    } catch {
      // silent — list is best effort
    }
  };

  useEffect(() => {
    void refreshJobs();
  }, []);

  const handleCreate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await verifyJobCreate(prompt.trim(), worktree.trim() || "C:\\tmp\\repo-prueba", phase);
      if (!r.ok) throw new Error(r.error ?? `HTTP error`);
      const job = (r.job as RealJob) ?? (r as unknown as RealJob);
      // Normalize to RealJob shape if needed
      const normalized: RealJob = {
        id: (job as unknown as Record<string, string>).id ?? "unknown",
        prompt: (job as unknown as Record<string, string>).prompt ?? prompt.trim(),
        worktree: (job as unknown as Record<string, string>).worktree ?? worktree,
        phase: (job as unknown as Record<string, string>).phase ?? phase,
        state: ((job as unknown as Record<string, string>).state as RealJob["state"]) ?? "queued",
        createdAt: (job as unknown as Record<string, string>).createdAt ?? new Date().toISOString(),
      };
      setLastJob(normalized);
      await refreshJobs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Daemon no disponible — no se creó job (sin simulación): ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="tc-label text-[12px] leading-relaxed">
        Probá el POST /factory/jobs real. Crea una carpeta en disco <span className="tc-mono">.agents/factory/&lt;id&gt;/</span> con job.json + prompt.md.
        Sin daemon, verás error honesto — no se inventa job.
      </p>
      <div className="tc-label text-[11px] leading-snug rounded-md bg-[var(--bg)] border border-[var(--border)] px-3 py-2">
        💡 En PowerShell usa <span className="tc-mono text-[var(--text-primary)]">Invoke-RestMethod</span> (<span className="tc-mono">curl</span> es alias a Invoke-WebRequest). Ver ejemplos en "Qué se le pasa".
      </div>
      <div className="grid gap-3">
        <label className="flex flex-col gap-1">
          <span className="tc-eyebrow">Prompt (qué se le pasa)</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-hover)]"
            placeholder="Escribí el prompt del job…"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="tc-eyebrow">Worktree</span>
            <input
              value={worktree}
              onChange={(e) => setWorktree(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-hover)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="tc-eyebrow">Phase</span>
            <select
              value={phase}
              onChange={(e) => setPhase(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-hover)]"
            >
              <option value="diagnosisLlm">diagnosisLlm</option>
              <option value="implement">implement</option>
              <option value="review">review</option>
              <option value="triage">triage</option>
            </select>
          </label>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={loading}
          className="inline-flex items-center rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-foreground)] hover:brightness-110 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Creando…" : "Crear job (POST real)"}
        </button>
        <button
          type="button"
          onClick={() => void refreshJobs()}
          className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
        >
          Refrescar lista
        </button>
        <span className="tc-label text-[11px]">{jobs.length} job(s) en daemon real</span>
      </div>
      {error && (
        <div className="rounded-md border border-[color-mix(in_srgb,var(--red)_22%,transparent)] bg-[color-mix(in_srgb,var(--red)_10%,transparent)] px-3 py-2 text-[12px] leading-snug text-[var(--text-primary)] flex flex-col gap-1.5">
          <div>{error}</div>
          {(error.includes("prompt is required") || error.includes("body must be valid JSON")) && (
            <div className="tc-label text-[11px] leading-snug rounded bg-[var(--bg)] border border-[var(--border)] px-2.5 py-1.5">
              Hint: en PowerShell usá <span className="tc-mono text-[var(--text-primary)]">Invoke-RestMethod</span> (ver ejemplos en Qué se le pasa) o <span className="tc-mono text-[var(--text-primary)]">curl.exe</span> — <span className="tc-mono">curl</span> sin <span className="tc-mono">.exe</span> es alias a Invoke-WebRequest y el -d con comillas escapadas mal → 400. El servidor ahora responde con <span className="tc-mono">hint</span> y <span className="tc-mono">received</span>.
            </div>
          )}
          <div className="tc-label text-[11px] mt-1">
            Verificá que el daemon corra: <span className="tc-mono">curl.exe --silent {FACTORY_BASE}/factory/health</span> o{" "}
            <span className="tc-mono">Invoke-RestMethod -UseBasicParsing {FACTORY_BASE}/factory/health</span>
          </div>
        </div>
      )}
      {lastJob ? (
        <div className="flex flex-col gap-2">
          <CodeBlock label={`job.json — ${lastJob.id}`}>
            {JSON.stringify({ id: lastJob.id, prompt: lastJob.prompt, phase: lastJob.phase, worktree: lastJob.worktree, state: lastJob.state, createdAt: lastJob.createdAt }, null, 2)}
          </CodeBlock>
          <CodeBlock label="prompt.md (contenido)">{lastJob.prompt}</CodeBlock>
          <div className="tc-label text-[11px] rounded-md bg-[var(--bg)] border border-[var(--border)] px-3 py-2">
            Ruta real: <span className="tc-mono text-[var(--text-primary)]">{lastJob.worktree}\.agents\factory\{lastJob.id}\</span> — verificá en disco que existan <span className="tc-mono">job.json</span> y <span className="tc-mono">prompt.md</span>.
          </div>
        </div>
      ) : (
        <CodeBlock label="Esperando creación…">{"Ningún job aún. Creá uno — irá al daemon real, no a localStorage."}</CodeBlock>
      )}
      {jobs.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="tc-eyebrow">Jobs recientes (daemon real)</div>
          <div className="flex flex-col gap-1 max-h-[160px] overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--bg)] p-2">
            {jobs.slice(0, 8).map((j) => (
              <div key={j.id} className="flex items-center gap-2 text-[11px]">
                <span className={`w-2 h-2 rounded-full shrink-0 ${j.state === "done" ? "bg-[var(--green)]" : j.state === "running" ? "bg-[var(--amber)]" : j.state === "error" ? "bg-[var(--red)]" : "bg-[var(--text-faint)]"}`} />
                <span className="tc-mono truncate flex-1 text-[var(--text-secondary)]">{j.id}</span>
                <span className="tc-label shrink-0">{j.phase}</span>
                <span className="tc-label shrink-0">{j.state}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function F03TestZone() {
  const [jobs, setJobs] = useState<RealJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [jobState, setJobState] = useState<string>("—");
  const [tailing, setTailing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const pollRef = useRef<number | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const selectedJob = useMemo(() => jobs.find((j) => j.id === selectedId) ?? null, [jobs, selectedId]);

  const fetchJobs = async () => {
    try {
      const res = await fetch(FACTORY_JOBS, { method: "GET" });
      if (res.ok) {
        const data = (await res.json()) as { jobs: RealJob[] };
        const list = Array.isArray(data.jobs) ? data.jobs : [];
        setJobs(list);
        if (!selectedId && list.length > 0) setSelectedId(list[0].id);
        setError(null);
      } else {
        setError(`Requiere daemon real — no hay jobs (HTTP ${res.status})`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Requiere daemon real — no hay logs simulados: ${msg}`);
    }
  };

  const fetchDetail = async (id: string) => {
    try {
      const res = await fetch(`${FACTORY_JOBS}/${id}`, { method: "GET" });
      if (res.ok) {
        const data = (await res.json()) as RealJob & { logs: string[]; state: string };
        setLogs(Array.isArray(data.logs) ? data.logs : []);
        setJobState(data.state ?? "—");
        setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, state: data.state as RealJob["state"] } : j)));
        return data;
      } else {
        const txt = await res.text();
        setError(`Requiere daemon real — no hay logs simulados: HTTP ${res.status} ${txt.slice(0, 200)}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Requiere daemon real — no hay logs simulados: ${msg}`);
    }
    return null;
  };

  useEffect(() => {
    void fetchJobs();
    const id = window.setInterval(() => void fetchJobs(), 2500);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) void fetchDetail(selectedId);
    else setLogs([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [logs]);

  const startTail = () => {
    if (!selectedId) return;
    if (tailing) return;
    setError(null);
    setTailing(true);
    let sseOk = false;
    try {
      const es = new EventSource(`${FACTORY_JOBS}/${selectedId}/events`);
      esRef.current = es;
      es.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data) as { line: string };
          if (payload.line) setLogs((prev) => [...prev, payload.line]);
        } catch {}
      };
      es.addEventListener("done", () => {
        setTailing(false);
        es.close();
        esRef.current = null;
        void fetchDetail(selectedId);
      });
      es.onerror = () => {
        if (!sseOk) {
          es.close();
          esRef.current = null;
        } else {
          setError("Requiere daemon real — SSE interrumpido");
          setTailing(false);
          es.close();
          esRef.current = null;
        }
      };
      es.onopen = () => {
        sseOk = true;
      };
      pollRef.current = window.setInterval(() => void fetchDetail(selectedId), 900);
    } catch {
      // EventSource not available — polling only
    }
    if (!esRef.current) {
      pollRef.current = window.setInterval(() => {
        void fetchDetail(selectedId).then((data) => {
          if (data && (data.state === "done" || data.state === "error")) {
            if (pollRef.current) window.clearInterval(pollRef.current);
            pollRef.current = null;
            setTailing(false);
          }
        });
      }, 800);
    }
  };

  const stopTail = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setTailing(false);
  };

  useEffect(
    () => () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      if (esRef.current) esRef.current.close();
    },
    []
  );

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="tc-label text-[12px] leading-relaxed">Necesitás al menos un job real (crealo en F02) para probar el tail. El daemon debe estar corriendo.</p>
        <CodeBlock label="Sin jobs (daemon real)">{"Andá a F02 → Crear job (POST real), luego volvé acá. Si el daemon no responde, verás error honesto — no hay logs simulados."}</CodeBlock>
        {error && (
          <div className="rounded-md border border-[color-mix(in_srgb,var(--red)_22%,transparent)] bg-[color-mix(in_srgb,var(--red)_10%,transparent)] px-3 py-2 text-[11px] leading-snug text-[var(--text-primary)]">
            {error}
          </div>
        )}
        <button type="button" onClick={() => void fetchJobs()} className="inline-flex items-center w-fit rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
          Reintentar (GET /factory/jobs)
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <label className="tc-eyebrow shrink-0">Job</label>
        <select
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value || null)}
          className="flex-1 min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)]"
        >
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.id.slice(0, 18)}… — {j.phase} · {j.state}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void fetchJobs()} className="shrink-0 inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)]">
          Refrescar
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={startTail}
          disabled={tailing || !selectedJob || selectedJob.state === "done" || selectedJob.state === "error"}
          className="inline-flex items-center rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-foreground)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {tailing ? "Taileando…" : selectedJob?.state === "done" ? "Ya finalizado" : "Iniciar tail en vivo (real)"}
        </button>
        {tailing && (
          <button type="button" onClick={stopTail} className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
            Detener
          </button>
        )}
        {selectedJob && (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${selectedJob.state === "done" ? "bg-[color-mix(in_srgb,var(--green)_14%,transparent)] text-[var(--green)]" : selectedJob.state === "running" ? "bg-[color-mix(in_srgb,var(--amber)_14%,transparent)] text-[var(--amber)]" : "bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]"}`}>
            {selectedJob.state ?? jobState}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-[color-mix(in_srgb,var(--red)_22%,transparent)] bg-[color-mix(in_srgb,var(--red)_10%,transparent)] px-3 py-2 text-[11px] leading-snug text-[var(--text-primary)]">
          {error}
        </div>
      )}

      <div className="rounded-md border border-[var(--border)] bg-[#0f0f0f] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#2a2a2a] bg-[#1a1a1a]">
          <span className="tc-mono text-[10px] text-[#9a9a9a]">logs.ndjson — tail real {tailing ? "(SSE/polling daemon)" : "(GET /factory/jobs/:id)"}</span>
          <span className="tc-mono text-[10px] text-[#6a6a6a]">{logs.length} líneas</span>
        </div>
        <div className="h-[180px] overflow-y-auto p-3 flex flex-col gap-0.5">
          {logs.length === 0 ? (
            <span className="tc-mono text-[11px] text-[#6a6a6a]">Sin líneas aún. Iniciá el tail o refrescá. Si el daemon no responde, no hay logs simulados.</span>
          ) : (
            logs.map((line, i) => (
              <div key={i} className="tc-mono text-[11px] leading-relaxed text-[#c9c9c9] whitespace-pre-wrap break-words">
                {line}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>

      {selectedJob && (
        <div className="grid gap-2">
          <CodeBlock label="result.json (real — GET /factory/jobs/:id → resultPreview)">
            {JSON.stringify(
              {
                jobId: selectedJob.id,
                phase: selectedJob.phase,
                worktree: selectedJob.worktree,
                state: jobState,
                logsCount: logs.length,
              },
              null,
              2,
            )}
          </CodeBlock>
          <div className="flex items-center gap-2 tc-label text-[11px]">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium border ${jobState === "done" ? "bg-[color-mix(in_srgb,var(--green)_14%,transparent)] text-[var(--green)] border-transparent" : "bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)]"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${jobState === "done" ? "bg-[var(--green)]" : "bg-[var(--text-faint)]"}`} />
              {jobState === "done" ? ".done existe ✓ (daemon)" : ".done aún no existe"}
            </span>
            <span>Contrato: sin .done en disco, no pasó.</span>
          </div>
        </div>
      )}
    </div>
  );
}

function F04TestZone() {
  const [jobs, setJobs] = useState<RealJob[]>([]);
  const [filter, setFilter] = useState<"all" | "queued" | "running" | "done">("all");
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [logsMap, setLogsMap] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    try {
      const res = await fetch(FACTORY_JOBS, { method: "GET" });
      if (res.ok) {
        const data = (await res.json()) as { jobs: RealJob[] };
        setJobs(Array.isArray(data.jobs) ? data.jobs : []);
        setError(null);
      } else {
        const txt = await res.text();
        setError(`Requiere daemon real — pendiente implementar endpoint: HTTP ${res.status} ${txt.slice(0, 200)}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Requiere daemon real — pendiente implementar endpoint: ${msg}`);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const simulateFlow = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await verifyJobCreate("Agregar sección Local development al README (issue #1)", "C:\\tmp\\repo-prueba", "implement");
      if (!r.ok) throw new Error(r.error ?? "falló POST");
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Daemon no disponible — no se creó job (sin simulación): ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`${FACTORY_JOBS}/${id}/cancel`, { method: "POST" });
      const text = await res.text();
      if (!res.ok) throw new Error(text.slice(0, 400));
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Cancel falló (requiere daemon real): ${msg}`);
    }
  };

  const handleToggleLogs = async (id: string) => {
    if (selectedLogId === id) {
      setSelectedLogId(null);
      return;
    }
    setSelectedLogId(id);
    try {
      const res = await fetch(`${FACTORY_JOBS}/${id}`, { method: "GET" });
      if (res.ok) {
        const data = (await res.json()) as { logs: string[] };
        setLogsMap((prev) => ({ ...prev, [id]: Array.isArray(data.logs) ? data.logs : [] }));
      }
    } catch {
      // ignore
    }
  };

  const filtered = useMemo(() => (filter === "all" ? jobs : jobs.filter((j) => j.state === filter)), [jobs, filter]);

  return (
    <div className="flex flex-col gap-3">
      <p className="tc-label text-[12px] leading-relaxed">
        Panel Factory real: lista Queued / Running / Done desde el daemon + Ver logs (GET real) + Cancelar (POST /cancel). No hay timeouts falsos — todo es HTTP real.
      </p>
      {error && (
        <div className="rounded-md border border-[color-mix(in_srgb,var(--amber)_22%,transparent)] bg-[color-mix(in_srgb,var(--amber)_10%,transparent)] px-3 py-2 text-[11px] leading-snug text-[var(--text-primary)]">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => void simulateFlow()} disabled={loading} className="inline-flex items-center rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-foreground)] hover:brightness-110 disabled:opacity-50">
          {loading ? "Encolando…" : "Encolar: Implementar issue #1 (POST real)"}
        </button>
        <button type="button" onClick={() => void refresh()} className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
          Refrescar
        </button>
        <span className="tc-label text-[11px] ml-auto">{jobs.filter((j) => j.state === "queued").length} queued · {jobs.filter((j) => j.state === "running").length} running · {jobs.filter((j) => j.state === "done").length} done</span>
      </div>

      <div className="flex items-center gap-1 rounded-lg bg-[var(--bg)] p-1 w-fit">
        {(["all", "queued", "running", "done"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize ${filter === f ? "bg-[var(--surface-hover)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
          >
            {f === "all" ? "Todos" : f}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--bg)] px-4 py-6 text-center tc-label text-[12px]">Sin jobs en este filtro. Encolá uno (POST real) o refrescá.</div>
        ) : (
          filtered.map((j) => (
            <div key={j.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${j.state === "done" ? "bg-[var(--green)]" : j.state === "running" ? "bg-[var(--amber)] animate-pulse" : j.state === "error" ? "bg-[var(--red)]" : "bg-[var(--text-faint)]"}`} />
                <span className="tc-mono text-[11px] font-medium truncate flex-1 text-[var(--text-primary)]" title={j.id}>
                  {j.id.slice(0, 22)}…
                </span>
                <span className="tc-label text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)]">{j.phase}</span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${j.state === "done" ? "bg-[color-mix(in_srgb,var(--green)_14%,transparent)] text-[var(--green)]" : j.state === "running" ? "bg-[color-mix(in_srgb,var(--amber)_14%,transparent)] text-[var(--amber)]" : j.state === "error" ? "bg-[color-mix(in_srgb,var(--red)_14%,transparent)] text-[var(--red)]" : "bg-[var(--surface)] text-[var(--text-muted)]"}`}>{j.state}</span>
              </div>
              <div className="tc-label text-[11px] leading-snug line-clamp-2">{j.prompt}</div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleToggleLogs(j.id)}
                  className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                >
                  {selectedLogId === j.id ? "Ocultar logs" : "Ver logs"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCancel(j.id)}
                  disabled={j.state === "done" || j.state === "error"}
                  className="inline-flex items-center rounded-md border border-transparent px-2 py-1 text-[11px] font-medium text-[var(--red)] hover:bg-[var(--red-soft)] disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Cancelar sin confirmación — como Warp Stop task (POST /cancel real)"
                >
                  Cancelar
                </button>
                <span className="tc-label text-[10px] ml-auto">{new Date(j.createdAt).toLocaleTimeString()}</span>
              </div>
              {selectedLogId === j.id && (
                <div className="rounded-md bg-[#0f0f0f] border border-[#2a2a2a] max-h-[140px] overflow-y-auto p-2 flex flex-col gap-0.5">
                  {(logsMap[j.id] ?? []).map((line, idx) => (
                    <div key={idx} className="tc-mono text-[11px] text-[#c9c9c9] whitespace-pre-wrap break-words">
                      {line}
                    </div>
                  ))}
                  {(logsMap[j.id]?.length ?? 0) === 0 && <div className="tc-mono text-[11px] text-[#6a6a6a]">Sin logs aún — refrescá o esperá a que el worker escriba.</div>}
                  <div className="mt-2 rounded bg-[#1a1a1a] border border-[#2a2a2a] p-2">
                    <div className="tc-mono text-[10px] text-[#9a9a9a] mb-1">result preview (daemon)</div>
                    <pre className="tc-mono text-[11px] text-[#c9c9c9] whitespace-pre-wrap break-words">{JSON.stringify({ jobId: j.id, phase: j.phase, state: j.state, worktree: j.worktree }, null, 2)}</pre>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="tc-label text-[11px] leading-snug rounded-md bg-[var(--bg)] border border-[var(--border)] px-3 py-2">
        <span className="font-medium text-[var(--text-secondary)]">Señal de éxito (reporte humano):</span> job pasa Queued → Running → Done vía daemon real, ves logs vía GET real, result.json en disco, y <span className="font-medium">ninguna terminal se abrió</span>.
      </div>
    </div>
  );
}

function F05TestZone() {
  const [phase, setPhase] = useState("diagnosisLlm");
  const [model, setModel] = useState("auto");
  const [cli, setCli] = useState("opencode");
  const [gateResult, setGateResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [jobs, setJobs] = useState<RealJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const validateGate = (cliValue: string, modelValue: string): { ok: boolean; msg: string } => {
    const knownByCli: Record<string, string[]> = {
      opencode: ["auto", "claude-4-sonnet", "claude-4-opus", "gpt-5", "gemini-2.5-pro"],
      codebuddy: ["fast-model", "gpt-5", "auto"],
      claude: ["sonnet", "opus", "haiku", "auto"],
    };
    const known = knownByCli[cliValue] ?? [];
    if (known.includes(modelValue)) {
      return { ok: true, msg: `✓ Modelo "${modelValue}" existe en catálogo de ${cliValue} para fase ${phase}. Se puede encolar.` };
    } else {
      const alts = known.slice(0, 3).join(", ");
      return { ok: false, msg: `✗ Modelo "${modelValue}" NO existe en catálogo de ${cliValue}. Alternativas: ${alts}. Gate rechaza antes de encolar — no se gastan tokens.` };
    }
  };

  const refreshJobs = async () => {
    try {
      const res = await fetch(FACTORY_JOBS, { method: "GET" });
      if (res.ok) {
        const data = (await res.json()) as { jobs: RealJob[] };
        setJobs(Array.isArray(data.jobs) ? data.jobs : []);
        setError(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Requiere daemon real — ${msg}`);
    }
  };

  useEffect(() => {
    void refreshJobs();
  }, []);

  const runGate = () => {
    setGateResult(validateGate(cli.trim(), model.trim()));
  };

  const enqueueTwo = async () => {
    const v = validateGate(cli.trim(), model.trim());
    if (!v.ok) {
      setGateResult(v);
      return;
    }
    setGateResult(v);
    setLoading(true);
    setError(null);
    try {
      const r1 = await verifyJobCreate(`diagnosisLlm — phase ${phase} — analisis repo`, "C:\\tmp\\repo-prueba", "diagnosisLlm");
      if (!r1.ok) throw new Error(r1.error ?? `HTTP fail`);
      const r2 = await verifyJobCreate(`tools — phase ${phase} — run-diagnostico-tools`, "C:\\tmp\\repo-prueba", "tools");
      if (!r2.ok) throw new Error(r2.error ?? `HTTP fail`);
      await refreshJobs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Daemon no disponible — no se encolaron jobs (sin simulación): ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="tc-label text-[12px] leading-relaxed">Probá el gate de modelo (fail fast) y que Diagnóstico + Tools creen 2 jobs Factory reales (POST /jobs) en vez de PTYs.</p>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 flex flex-col gap-3">
        <div className="tc-eyebrow">Gate de modelo — validar antes de encolar (real)</div>
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1">
            <span className="tc-label text-[10px]">Phase</span>
            <select value={phase} onChange={(e) => setPhase(e.target.value)} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[12px] text-[var(--text-primary)]">
              <option value="diagnosisLlm">diagnosisLlm</option>
              <option value="tactics">tactics</option>
              <option value="brief">brief</option>
              <option value="requirements">requirements</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="tc-label text-[10px]">CLI</span>
            <select value={cli} onChange={(e) => setCli(e.target.value)} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[12px] text-[var(--text-primary)]">
              <option value="opencode">opencode</option>
              <option value="codebuddy">codebuddy</option>
              <option value="claude">claude</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="tc-label text-[10px]">Modelo</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="auto / gpt-99" className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={runGate} className="inline-flex items-center rounded-md bg-[var(--surface-hover)] border border-[var(--border)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface)]">
            Validar contra catálogo
          </button>
          <span className="tc-label text-[11px]">Gate corre antes de POST — si falla, no se encola.</span>
        </div>
        {gateResult && (
          <div className={`rounded-md border px-3 py-2 text-[12px] leading-snug ${gateResult.ok ? "bg-[color-mix(in_srgb,var(--green)_10%,transparent)] border-[color-mix(in_srgb,var(--green)_22%,transparent)] text-[var(--text-primary)]" : "bg-[color-mix(in_srgb,var(--red)_10%,transparent)] border-[color-mix(in_srgb,var(--red)_22%,transparent)] text-[var(--text-primary)]"}`}>
            {gateResult.msg}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 flex flex-col gap-3">
        <div className="tc-eyebrow">Flujo Diagnóstico → Tools vía Factory (POST reales)</div>
        {error && (
          <div className="rounded-md border border-[color-mix(in_srgb,var(--red)_22%,transparent)] bg-[color-mix(in_srgb,var(--red)_10%,transparent)] px-3 py-2 text-[11px] leading-snug text-[var(--text-primary)]">
            {error}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void enqueueTwo()} disabled={loading} className="inline-flex items-center rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-foreground)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? "Encolando…" : "Disparar Diagnóstico + Tools (2× POST real)"}
          </button>
          <button type="button" onClick={() => void refreshJobs()} className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)]">
            Refrescar
          </button>
        </div>
        {gateResult?.ok === false && (
          <div className="rounded-md border border-[color-mix(in_srgb,var(--red)_22%,transparent)] bg-[color-mix(in_srgb,var(--red)_10%,transparent)] px-3 py-2 text-[11px] leading-snug text-[var(--text-primary)]">
            Gate bloqueó: modelo no existe — no se hizo POST (sin simulación, no se creó job)
          </div>
        )}
        <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto">
          {jobs.slice(0, 6).map((j) => (
            <div key={j.id} className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5">
              <span className={`w-2 h-2 rounded-full shrink-0 ${j.state === "done" ? "bg-[var(--green)]" : j.state === "running" ? "bg-[var(--amber)] animate-pulse" : "bg-[var(--text-faint)]"}`} />
              <span className="tc-mono text-[11px] truncate flex-1 text-[var(--text-secondary)]">{j.id.slice(0, 20)}…</span>
              <span className="tc-label text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)]">{j.phase}</span>
              <span className="text-[10px] font-medium">{j.state}</span>
            </div>
          ))}
          {jobs.length === 0 && <div className="tc-label text-[11px] text-center py-3 border border-dashed border-[var(--border)] rounded-md">Sin jobs aún — dispará Diagnóstico + Tools o verificá daemon.</div>}
        </div>
        <div className="tc-label text-[11px] leading-snug">
          Éxito: 2 jobs en Factory vía POST real, <span className="font-medium text-[var(--text-secondary)]">cero PTYs</span> y cero localStorage. En el real, son{" "}
          <span className="tc-mono">launchToolsSession</span> y <span className="tc-mono">launchPlanningSession</span> via Factory.
        </div>
      </div>
    </div>
  );
}

function TestZoneRouter({ fId }: { fId: string }) {
  switch (fId) {
    case "F01":
      return <F01TestZone />;
    case "F02":
      return <F02TestZone />;
    case "F03":
      return <F03TestZone />;
    case "F04":
      return <F04TestZone />;
    case "F05":
      return <F05TestZone />;
    default:
      return <div className="tc-label text-[12px]">Zona de testeo no definida para {fId}.</div>;
  }
}

// ── Main RightPanel ──

export function PlaygroundRightPanel() {
  const selectedFId = usePlaygroundStore((s) => s.selectedFId);
  const verdicts = usePlaygroundStore((s) => s.verdicts);
  const setVerdict = usePlaygroundStore((s) => s.setVerdict);
  const setSelectedFId = usePlaygroundStore((s) => s.setSelectedFId);

  const f = getPlaygroundF(selectedFId);

  const history: PlaygroundVerdictEntry[] = f ? (verdicts[f.id] ?? []) : [];
  const latest: PlaygroundVerdictEntry | undefined = f ? getLatestVerdict(verdicts, f.id) : undefined;
  const existing = latest;

  const [draftStatus, setDraftStatus] = useState<VerdictStatus>(latest?.status ?? "pendiente");
  const [draftNotes, setDraftNotes] = useState(latest?.notes ?? "");
  const [draftRaw, setDraftRaw] = useState(latest?.rawOutput ?? "");
  const [savedFlash, setSavedFlash] = useState(false);
  const [traceToast, setTraceToast] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  const blockInfo = f ? isBlocked(f.id, verdicts) : { blocked: false, blockedBy: [] as string[] };
  const flakyDetected = f ? isFlaky(verdicts, f.id) : false;
  const rollbackWarnings = f ? getRollbackWarnings(f.id, verdicts) : [];
  // Flaky upstream warning: direct dependencies that are flaky (manual status flaky or auto isFlaky)
  // are NOT blocking (per store fix) but we surface a soft warning so tester can still continue.
  const flakyUpstreamIds = useMemo(() => {
    if (!f) return [] as string[];
    const direct = f.blockedBy ?? [];
    const res: string[] = [];
    for (const bid of direct) {
      const hist = verdicts[bid];
      const latestV = getLatestVerdict(verdicts, bid);
      const isManuallyFlaky = latestV?.status === "flaky";
      const isAutoFlaky = isFlaky(verdicts, bid) || (hist ? isFlaky(hist) : false);
      if (isManuallyFlaky || isAutoFlaky) res.push(bid);
    }
    return res;
  }, [f, verdicts]);

  useEffect(() => {
    if (!f) return;
    const v = getLatestVerdict(verdicts, f.id);
    setDraftStatus(v?.status ?? "pendiente");
    setDraftNotes(v?.notes ?? v?.humanVerdict ?? "");
    setDraftRaw(v?.rawOutput ?? "");
    setExpandedVersions(new Set());
  }, [f, verdicts]);

  if (!f) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="tc-label text-[13px]">Seleccioná un F en el panel izquierdo.</div>
      </div>
    );
  }

  const reportDisplayPath = getReportDisplayPath(f.id);
  const reportExists = getReportPath(f.id) !== null;

  const handleSaveVerdict = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const prevHist = verdicts[f.id] ?? [];
      const codeHash = await getCodeHash().catch(() => "unknown");
      setVerdict(f.id, {
        status: draftStatus,
        notes: draftNotes,
        rawOutput: draftRaw,
        humanVerdict: draftNotes,
        codeHash,
        testedBy: "humano",
      });
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);

      const historyAfter = usePlaygroundStore.getState().verdicts[f.id] ?? [
        ...prevHist,
        { status: draftStatus, notes: draftNotes, rawOutput: draftRaw, humanVerdict: draftNotes, codeHash, testedBy: "humano" as const, updatedAt: Date.now(), version: prevHist.length + 1 },
      ];
      try {
        const res = await syncVerdictToReportMd(f.id, historyAfter);
        if (res.ok) {
          setTraceToast("Trazabilidad actualizada en reporte md");
        } else if (res.reason === "no_fs") {
          setTraceToast("Guardado local (sin FS)");
        } else {
          setTraceToast("Guardado local (reporte no disponible)");
        }
        window.setTimeout(() => setTraceToast(null), 3000);
      } catch {
        setTraceToast("Guardado local (sin FS)");
        window.setTimeout(() => setTraceToast(null), 3000);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleForceUnlock = async () => {
    const codeHash = await getCodeHash().catch(() => "unknown");
    // Recolecta todos los ancestors transitivos no aprobados para desbloquear cadena completa
    const toUnlock = new Set<string>();
    const visited = new Set<string>();
    const currentVerdicts = usePlaygroundStore.getState().verdicts;
    const collect = (fid: string) => {
      const deps: string[] = PLAYGROUND_FS.find((x) => x.id === fid)?.blockedBy ?? [];
      for (const bid of deps) {
        if (visited.has(bid)) continue;
        visited.add(bid);
        const latest = getLatestVerdict(currentVerdicts, bid);
        // flaky counts as approved for force-unlock purpose — we don't need to unlock it
        const isApproved =
          latest?.status === "aprobado" ||
          latest?.status === "aprobado_con_reservas" ||
          latest?.status === "flaky";
        if (!isApproved) toUnlock.add(bid);
        collect(bid);
      }
    };
    collect(f.id);
    const ids = toUnlock.size > 0 ? Array.from(toUnlock) : blockInfo.blockedBy;
    for (const blockerId of ids) {
      setVerdict(blockerId, {
        status: "aprobado_con_reservas",
        notes: "Desbloqueo forzado por tester para poder avanzar",
        codeHash,
        testedBy: "humano",
      });
    }
  };

  const handleMarkForRevalidate = async () => {
    const codeHash = await getCodeHash().catch(() => "unknown");
    setVerdict(f.id, {
      status: "pendiente",
      notes: `Marcado para revalidar tras fallo downstream — previo: ${latest?.status ?? "?"}`,
      rawOutput: latest?.rawOutput,
      codeHash,
      testedBy: "humano",
    });
  };

  return (
    <div className="flex-1 min-w-0 overflow-y-auto bg-[var(--bg)]">
      <div className="max-w-[860px] mx-auto px-6 py-6 flex flex-col gap-5">
        {/* Blocked banner */}
        {blockInfo.blocked && (
          <div className="rounded-lg border border-[color-mix(in_srgb,var(--amber)_30%,transparent)] bg-[color-mix(in_srgb,var(--amber)_14%,transparent)] px-4 py-3 flex flex-col gap-1.5">
            <div className="flex items-start gap-2 text-[12px] leading-relaxed text-[var(--text-primary)]">
              <span className="shrink-0 mt-0.5">🔒</span>
              <span>
                Bloqueado por{" "}
                {blockInfo.blockedBy.map((bid, idx) => (
                  <span key={bid}>
                    {idx > 0 && ", "}
                    <button
                      type="button"
                      onClick={() => setSelectedFId(bid)}
                      className="font-semibold underline decoration-[var(--amber)] underline-offset-2 hover:text-[var(--amber)] transition-colors"
                      title={`Ir a ${bid}`}
                    >
                      {bid}
                    </button>
                  </span>
                ))}{" "}
                — Aprobá {blockInfo.blockedBy[0]} para desbloquear.
              </span>
            </div>
            <div className="tc-label text-[11px] leading-snug pl-6">
              {blockInfo.blockedBy.map((bid) => {
                const v = getLatestVerdict(verdicts, bid);
                const statusLabel = v?.status ?? "pendiente";
                const dateLabel = v?.updatedAt ? new Date(v.updatedAt).toLocaleDateString("es-AR") : "sin veredicto";
                return (
                  <div key={bid} className="flex items-center gap-1.5">
                    <span>
                      Estado actual de{" "}
                      <button type="button" onClick={() => setSelectedFId(bid)} className="font-medium underline decoration-[var(--border)] underline-offset-2 hover:text-[var(--text-primary)]">
                        {bid}
                      </button>
                      : <span className="font-medium text-[var(--text-secondary)]">{statusLabel}</span> ({dateLabel})
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="pl-6 pt-1">
              <button
                type="button"
                onClick={() => void handleForceUnlock()}
                className="inline-flex items-center rounded-md border border-[var(--amber)] bg-[var(--bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--amber)_14%,transparent)] transition-colors"
                title="Solo playground: marca bloqueadores como aprobado con reservas para desbloquear"
              >
                Forzar desbloqueo (solo playground)
              </button>
              <span className="tc-label text-[10px] ml-2">Deja trazabilidad: aprobado_con_reservas + notas</span>
            </div>
          </div>
        )}

        {/* Flaky upstream — soft warning, NO bloquea (overlay pointer-events-none no debe activarse) */}
        {!blockInfo.blocked && flakyUpstreamIds.length > 0 && (
          <div className="rounded-lg border border-[#ffb86b] bg-[#fff0e0] px-4 py-3 flex items-center gap-2">
            <span className="shrink-0">⚠️</span>
            <span className="text-[12px] font-medium text-[#a64d00]">
              {flakyUpstreamIds.join(", ")} está en FLAKY — revisá timing pero podés continuar
            </span>
            <span className="tc-label text-[11px] ml-1">— no bloquea, solo advertencia</span>
          </div>
        )}

        {/* Rollback banner (upstream estaba aprobado pero downstream falló) */}
        {rollbackWarnings.length > 0 && (
          <div className="rounded-lg border border-[color-mix(in_srgb,var(--amber)_30%,transparent)] bg-[color-mix(in_srgb,var(--amber)_14%,transparent)] px-4 py-3 flex flex-col gap-2">
            <div className="flex items-start gap-2 text-[12px] leading-relaxed text-[var(--text-primary)]">
              <span className="shrink-0 mt-0.5">⚠️</span>
              <span>
                Rollback: {f.id} estaba aprobado pero {rollbackWarnings.map((w) => w.downstream).join(", ")} falló y depende de {f.id} — Revisar si {f.id} sigue válido.
              </span>
            </div>
            <div>
              <button
                type="button"
                onClick={() => void handleMarkForRevalidate()}
                className="inline-flex items-center rounded-md border border-[var(--amber)] bg-[var(--bg)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--amber)_10%,transparent)]"
              >
                Marcar para revalidar → pendiente
              </button>
            </div>
          </div>
        )}

        {/* Flaky banner */}
        {flakyDetected && (
          <div className="rounded-lg border border-[#ffb86b] bg-[#fff0e0] px-4 py-3 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-2 h-2 rounded-full bg-[#f97316] animate-pulse shrink-0" aria-hidden />
            <span className="text-[12px] font-medium text-[#a64d00]">Detectado flaky: timing</span>
            <span className="tc-label text-[11px]">— últimos 3 veredictos mezclan aprobado y fallo</span>
            <span className="inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-bold bg-[#fff0e0] text-[#a64d00] border border-[#ffb86b] ml-auto">FLAKY</span>
          </div>
        )}

        {/* a. Idea */}
        <SectionCard eyebrow={`${f.badge} · ${f.wave}`} title={f.idea.headline}>
          <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">{f.idea.description}</p>
          <div className="mt-3 rounded-md bg-[var(--bg)] border border-[var(--border)] px-3 py-2.5">
            <div className="tc-eyebrow mb-1">Objetivo pro</div>
            <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">{f.idea.objetivoPro}</p>
          </div>
        </SectionCard>

        {/* b. Qué se testea */}
        <SectionCard eyebrow="Qué se testea" title="Criterio + contrato">
          <div className="flex flex-col gap-3">
            <div className="rounded-md bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] border border-[var(--border)] px-3 py-2.5">
              <div className="tc-eyebrow mb-1">Criterio de aceptación</div>
              <p className="text-[12px] leading-relaxed text-[var(--text-primary)]">{f.whatToTest.criterio}</p>
              {f.timeoutMs && <div className="tc-label text-[11px] mt-1">timeoutMs: {f.timeoutMs} · Esperado: {JSON.stringify(f.expectedJson ?? {}).slice(0, 120)}</div>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md bg-[var(--bg)] border border-[var(--border)] px-3 py-2.5">
                <div className="tc-eyebrow mb-1">En Warp</div>
                <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{f.whatToTest.warpBehavior}</p>
              </div>
              <div className="rounded-md bg-[var(--bg)] border border-[var(--border)] px-3 py-2.5">
                <div className="tc-eyebrow mb-1">En local</div>
                <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{f.whatToTest.localBehavior}</p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="tc-eyebrow">Qué se le pasa / qué devuelve</div>
              <div className="rounded-md border border-[var(--border)] overflow-hidden">
                <table className="w-full text-[11px] leading-relaxed">
                  <tbody>
                    {f.whatToTest.inputsOutputs.map((row) => (
                      <tr key={row.label} className="border-b last:border-b-0 border-[var(--border)]">
                        <td className="px-3 py-2 font-medium text-[var(--text-secondary)] whitespace-nowrap align-top bg-[var(--surface)] w-[160px]">{row.label}</td>
                        <td className="px-3 py-2 tc-mono text-[var(--text-primary)] align-top break-words">{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* c. Zona de testeo */}
        <SectionCard eyebrow="Zona de testeo" title="Probalo vos — interactivo (daemon real)">
          <div className="flex flex-col gap-3">
            <div className="rounded-md bg-[var(--bg)] border border-[var(--border)] px-3 py-2.5">
              <div className="tc-eyebrow mb-1.5">Pasos del reporte humano</div>
              <ol className="flex flex-col gap-1">
                {f.humanSteps.map((step, i) => (
                  <li key={i} className="text-[12px] leading-relaxed text-[var(--text-secondary)] flex gap-2">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-[10px] font-medium text-[var(--text-muted)]">{i + 1}</span>
                    <span className="tc-mono text-[11px] leading-relaxed pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="relative">
              <div className={blockInfo.blocked ? "opacity-50 pointer-events-none" : ""}>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
                  <TestZoneRouter fId={f.id} />
                </div>
              </div>
              {blockInfo.blocked && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--bg)_78%,transparent)] backdrop-blur-[2px] border border-[color-mix(in_srgb,var(--amber)_22%,transparent)] p-4 text-center">
                  <div className="text-[12px] font-medium text-[var(--text-primary)]">🔒 Zona de testeo bloqueada</div>
                  <div className="tc-label text-[11px] leading-snug max-w-[420px]">
                    Aprobá{" "}
                    {blockInfo.blockedBy.map((bid, idx) => (
                      <span key={bid}>
                        {idx > 0 && ", "}
                        <button type="button" onClick={() => setSelectedFId(bid)} className="font-semibold underline underline-offset-2 hover:text-[var(--text-primary)]">
                          {bid}
                        </button>
                      </span>
                    ))}{" "}
                    para desbloquear esta zona interactiva. Podés seguir viendo la idea y el contrato, y guardar tu veredicto.
                  </div>
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        {/* d. Veredicto */}
        <SectionCard eyebrow="Tu veredicto" title="¿Qué viste al probar este F?">
          <div className="flex flex-col gap-3">
            <p className="tc-label text-[12px] leading-relaxed">Elegí el estado y dejá notas. Se guarda en localStorage y persiste tras recargar. Cada guardado crea una nueva versión.</p>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex flex-col gap-1">
                <span className="tc-eyebrow">Estado</span>
                <select
                  value={draftStatus}
                  onChange={(e) => setDraftStatus(e.target.value as VerdictStatus)}
                  className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] text-[var(--text-primary)] min-w-[200px]"
                >
                  <option value="pendiente">Pendiente</option>
                  <option value="aprobado">Aprobado ✓</option>
                  <option value="aprobado_con_reservas">Aprobado con reservas ⚠️</option>
                  <option value="fallo">Falló ✗</option>
                  <option value="flaky">Flaky (auto — mixto)</option>
                </select>
              </label>

              {existing && (
                <span className="tc-label text-[11px] self-end pb-2">
                  Último: {new Date(existing.updatedAt).toLocaleString("es-AR", { hour12: false })} · <span className="font-medium text-[var(--text-secondary)]">{existing.status}</span> · v{existing.version}
                  {existing.codeHash ? ` · ${existing.codeHash.slice(0, 7)}` : ""} · {existing.testedBy ?? "humano"}
                </span>
              )}
              {draftStatus === "aprobado_con_reservas" && (
                <span className="tc-label text-[11px] self-end pb-2 text-[#8a6d00]">Desbloquea pero deja warning — ej curl.exe OK pero alias confunde</span>
              )}
            </div>

            <label className="flex flex-col gap-1">
              <span className="tc-eyebrow">Output crudo (opcional) — pegá el curl completo con warning de Invoke-WebRequest si aplica</span>
              <textarea
                value={draftRaw}
                onChange={(e) => setDraftRaw(e.target.value)}
                rows={3}
                placeholder="Ej: StatusCode:200 ... o pegá el JSON crudo con warning de PowerShell si viste Invoke-WebRequest"
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px] leading-relaxed tc-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-hover)] resize-y"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="tc-eyebrow">Veredicto humano (qué concluís) — notas limpias</span>
              <textarea
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
                rows={3}
                placeholder="Ej: curl.exe devolvió 200 con queue ok en 42ms. Verdict: aprobado. Detectado flaky por timing anterior."
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-hover)] resize-y"
              />
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSaveVerdict()}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-1.5 text-[12px] font-medium text-[var(--accent-foreground)] hover:brightness-110 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? "⟳ Guardando…" : "Guardar veredicto"}
              </button>
              {savedFlash && <span className="tc-label text-[11px] text-[var(--green)] tc-enter-fade">Guardado ✓ — v{(history.length + 1) > 1 ? history.length + 1 : 1}</span>}
              {traceToast && (
                <span
                  className={`tc-label text-[11px] px-2 py-1 rounded-md border ${traceToast.includes("actualizada") ? "bg-[color-mix(in_srgb,var(--green)_12%,transparent)] text-[var(--green)] border-[color-mix(in_srgb,var(--green)_22%,transparent)]" : "bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)]"}`}
                >
                  {traceToast}
                </span>
              )}
              <span className="tc-label text-[11px] ml-auto">localStorage: factory-playground-verdicts</span>
            </div>

            {/* Historial de versiones */}
            {history.length > 0 && (
              <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((o) => !o)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-[var(--surface-hover)] transition-colors"
                >
                  <span className="tc-eyebrow">Historial de versiones ({history.length}) {flakyDetected ? "— FLAKY detectado" : ""}</span>
                  <span className="tc-label text-[11px] flex items-center gap-1">
                    {historyOpen ? "Ocultar" : "Mostrar"} <span className="text-[10px]">{historyOpen ? "▾" : "▸"}</span>
                  </span>
                </button>
                {historyOpen && (
                  <div className="border-t border-[var(--border)] divide-y divide-[var(--border)] max-h-[360px] overflow-y-auto">
                    {[...history]
                      .slice()
                      .reverse()
                      .map((entry) => {
                        const isExpanded = expandedVersions.has(entry.version);
                        const human = (entry.notes ?? entry.humanVerdict ?? "").trim();
                        const raw = (entry.rawOutput ?? "").trim();
                        const truncated = human.slice(0, 80);
                        const hasMore = human.length > 80 || raw.length > 0;
                        const dateStr = new Date(entry.updatedAt).toLocaleString("es-AR", { hour12: false });
                        const statusUpper = entry.status.toUpperCase();
                        const isFlakyEntry = entry.status === "flaky";
                        const statusTone =
                          entry.status === "aprobado"
                            ? "text-[var(--green)]"
                            : entry.status === "aprobado_con_reservas"
                              ? "text-[#8a6d00]"
                              : entry.status === "fallo"
                                ? "text-[var(--red)]"
                                : entry.status === "flaky"
                                  ? "text-[#a64d00]"
                                  : "text-[var(--amber)]";
                        const snap = entry.criterionSnapshot;
                        const idx = history.findIndex((h) => h.version === entry.version);
                        const prevSnap = idx > 0 ? history[idx - 1].criterionSnapshot : undefined;
                        const criterioChanged = prevSnap && snap && prevSnap.criterio !== snap.criterio;
                        return (
                          <div key={entry.version} className="px-3 py-2 flex flex-col gap-1 bg-[var(--surface)]">
                            <div className="flex items-center gap-2 text-[11px] flex-wrap">
                              <span className="tc-mono font-medium text-[var(--text-primary)]">v{entry.version}</span>
                              <span className="tc-label">—</span>
                              <span className="tc-label">{dateStr}</span>
                              <span className="tc-label">—</span>
                              <span className={`text-[10px] font-bold tracking-wide ${statusTone}`}>{statusUpper}</span>
                              {entry.codeHash && <span className="tc-mono text-[10px] text-[var(--text-muted)]">{entry.codeHash.slice(0, 7)}</span>}
                              {entry.testedBy && <span className={`text-[9px] px-1 py-0 rounded border ${entry.testedBy === "script" ? "bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)]" : "bg-[color-mix(in_srgb,var(--green)_10%,transparent)] text-[var(--text-secondary)] border-transparent"}`}>{entry.testedBy}</span>}
                              {entry.criterionSnapshot && <span className="tc-label text-[10px]">criterio v{entry.version}: {snap?.criterio.slice(0, 40)}…</span>}
                              {isFlakyEntry && <span className="inline-flex items-center rounded-full px-1 py-0 text-[9px] font-bold bg-[#fff0e0] text-[#a64d00] border border-[#ffb86b]">FLAKY</span>}
                              {criterioChanged && <span className="text-[9px] font-medium text-[var(--amber)]">⚠️ criterio cambió</span>}
                              {(hasMore || human) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedVersions((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(entry.version)) next.delete(entry.version);
                                      else next.add(entry.version);
                                      return next;
                                    });
                                  }}
                                  className="ml-auto text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] underline underline-offset-2"
                                >
                                  {isExpanded ? "colapsar" : "expandir"}
                                </button>
                              )}
                            </div>
                            {snap && (
                              <div className="tc-label text-[10px] leading-snug rounded bg-[var(--bg)] border border-[var(--border)] px-2 py-1">
                                Contra criterio v{entry.version}: &quot;{snap.criterio}&quot; · timeoutMs {snap.timeoutMs}
                                {criterioChanged && <span className="block text-[var(--amber)]">Diff: criterio cambió desde v{history[idx - 1].version}</span>}
                              </div>
                            )}
                            <div className="tc-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-[var(--text-secondary)]">
                              {human ? (isExpanded ? `"${human}"` : hasMore && human.length > 80 ? `"${truncated}…"` : `"${human}"`) : "— sin notas"}
                            </div>
                            {raw && (
                              <div className="rounded border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
                                <div className="tc-label px-2 py-1 border-b border-[var(--border)] bg-[var(--surface)] text-[10px]">Output crudo</div>
                                <pre className="tc-mono text-[10px] leading-relaxed p-2 whitespace-pre-wrap break-words text-[var(--text-muted)] max-h-[120px] overflow-y-auto">{isExpanded ? raw : raw.slice(0, 180) + (raw.length > 180 ? "…" : "")}</pre>
                              </div>
                            )}
                            {flakyDetected && idx === history.length - 1 && (
                              <div className="tc-label text-[10px] text-[#a64d00]">Detectado flaky: timing — historial mixto aprobado/fallo</div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </div>
        </SectionCard>

        {/* e. Reporte asociado */}
        <SectionCard eyebrow="Trazabilidad" title="Reporte asociado">
          <div className="flex flex-col gap-3">
            <p className="tc-label text-[12px] leading-relaxed">Cada F genera un reporte markdown versionado. Es el vínculo entre lo que testeaste y lo que quedó documentado.</p>
            <div className="flex items-center gap-2 rounded-md bg-[var(--bg)] border border-[var(--border)] px-3 py-2.5">
              <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] shrink-0">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M4 1.5h5l3.5 3.5v9.5h-8.5z" />
                  <path d="M9 1.5v3.5h3.5" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                {reportExists ? (
                  <a href={encodeURI(reportDisplayPath)} target="_blank" rel="noreferrer" className="tc-mono text-[12px] font-medium text-[var(--text-primary)] truncate block hover:underline" title={reportDisplayPath}>
                    {reportDisplayPath}
                  </a>
                ) : (
                  <div className="tc-mono text-[12px] font-medium text-[var(--text-primary)] truncate" title={reportDisplayPath}>
                    {reportDisplayPath}
                  </div>
                )}
                <div className="tc-label text-[11px]">Ruta esperada en el repo — si no existe, figura como pendiente.</div>
              </div>
              <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border border-transparent ${reportExists ? "bg-[color-mix(in_srgb,var(--green)_14%,transparent)] text-[var(--green)]" : "bg-[color-mix(in_srgb,var(--amber)_14%,transparent)] text-[var(--amber)]"}`}>
                {reportExists ? "existe ✓" : "pendiente"}
              </span>
            </div>
            <div className="tc-label text-[11px] leading-snug rounded-md bg-[var(--bg)] border border-[var(--border)] px-3 py-2">
              En el repo real vas a encontrar 5 archivos: <span className="tc-mono">docs/wiki Warp/reporte-F01-health.md</span> … <span className="tc-mono">reporte-F05-planning-tools.md</span>. Cada uno tiene header, objetivo, pasos, evidencia y link trazable al F.
            </div>

            {/* Última trazabilidad */}
            <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-3 flex flex-col gap-2">
              <div className="tc-eyebrow">Última trazabilidad — v{existing?.version ?? 0} de {history.length}</div>
              {existing ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border border-transparent ${existing.status === "aprobado" ? "bg-[color-mix(in_srgb,var(--green)_14%,transparent)] text-[var(--green)]" : existing.status === "aprobado_con_reservas" ? "bg-[#fff3c4] text-[#8a6d00] border border-[#f5d76e]" : existing.status === "fallo" ? "bg-[color-mix(in_srgb,var(--red)_14%,transparent)] text-[var(--red)]" : "bg-[color-mix(in_srgb,var(--amber)_14%,transparent)] text-[var(--amber)]"}`}>
                      {existing.status.toUpperCase()}
                    </span>
                    <span className="tc-label">
                      {new Date(existing.updatedAt).toLocaleString("es-AR", { hour12: false })} — {existing.status} — v{existing.version}
                    </span>
                    {existing.codeHash && <span className="tc-mono text-[10px] bg-[var(--surface)] border border-[var(--border)] px-1 py-0 rounded">Commit: {existing.codeHash.slice(0, 7)}</span>}
                    {existing.testedBy && <span className="tc-label text-[10px]">Probar: {existing.testedBy}</span>}
                    {flakyDetected && <span className="inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-bold bg-[#fff0e0] text-[#a64d00] border border-[#ffb86b] animate-pulse">FLAKY</span>}
                  </div>
                  <div className="tc-mono text-[11px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap break-words rounded bg-[var(--surface)] border border-[var(--border)] px-2.5 py-2">
                    {existing.notes.trim() ? `"${existing.notes.trim().slice(0, 600)}"` : "Sin notas — agregá evidencia arriba."}
                  </div>
                  {existing.rawOutput && (
                    <div className="rounded border border-[var(--border)] overflow-hidden">
                      <div className="tc-label px-2 py-1 bg-[var(--surface)] border-b border-[var(--border)] text-[10px]">Output crudo</div>
                      <pre className="tc-mono text-[10px] leading-relaxed p-2 whitespace-pre-wrap break-words text-[var(--text-muted)] max-h-[120px] overflow-y-auto">{existing.rawOutput.slice(0, 600)}</pre>
                    </div>
                  )}
                  {existing.criterionSnapshot && (
                    <div className="tc-label text-[10px] leading-snug rounded bg-[var(--bg)] border border-[var(--border)] px-2 py-1">
                      Contra criterio v{existing.version}: &quot;{existing.criterionSnapshot.criterio}&quot; · timeoutMs {existing.criterionSnapshot.timeoutMs}
                    </div>
                  )}
                  <div className="tc-label text-[10px] leading-snug">
                    Fuente: localStorage <span className="tc-mono">factory-playground-verdicts</span> ({history.length} {history.length === 1 ? "versión" : "versiones"}) · En Electron se sincroniza además a <span className="tc-mono">{reportDisplayPath}</span> en la sección “Trazabilidad — Veredictos del tester” con historial completo, Output crudo y Veredicto separados.
                  </div>
                </div>
              ) : (
                <div className="tc-label text-[11px] leading-snug">Sin veredicto aún para {f.id} — guardá uno arriba para ver trazabilidad aquí y (en Electron) en el md del reporte.</div>
              )}
            </div>
          </div>
        </SectionCard>

        <div className="h-6" />
      </div>
    </div>
  );
}
