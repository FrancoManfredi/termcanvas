// ValidationPage — SRP: validation & fixtures view, live FactoryRegistry validation
// DIP: reads from validation.derive + FactoryRegistry (pure) — OCP: add example via validation.derive without touching this file
import { useMemo, useState } from "react";
import {
  SCHEMA_URLS,
  SCHEMA_AUTH,
  VALIDATE_TOOL,
  GET_SCHEMA_TOOL,
  FACTORY_MCP_ENDPOINT,
  WARP_FACTORY_EXAMPLES,
  COPYABLE_EXAMPLES,
  EXAMPLE_01_SINGLE_REPO_QUICKSTART,
  validateWithParser,
} from "../../lib/factory/domain/validation.derive";
import { FactoryRegistry } from "../../lib/factory/store/factoryRegistry";
import {
  SAMPLE_FACTORY_MINIMAL,
  SAMPLE_AGENT_FOREMAN,
  SAMPLE_RUNNER_LINUX,
  SAMPLE_AUTOMATION_LABELED,
  SAMPLE_SCORER_TESTS,
} from "../../lib/factory/fixtures/samples";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      });
    }
  }
  return (
    <button
      onClick={handleCopy}
      className="rounded bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-zinc-800"
      type="button"
    >
      {copied ? "Copiado ✓" : "Copiar"}
    </button>
  );
}

function CopyFileLineButton({ fileLine }: { fileLine: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(fileLine).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      });
    }
  }
  return (
    <button
      onClick={handleCopy}
      className="ml-1 rounded bg-zinc-800 px-1 py-0.5 text-[10px] font-medium text-white hover:bg-zinc-700"
      type="button"
      aria-label={`Copy ${fileLine}`}
      title="Copy file:line"
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}

function CodeBlock({ path, raw, language }: { path: string; raw: string; language: string }) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-1.5">
        <span className="font-mono text-[11px] text-zinc-700">{path}</span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.06em] text-zinc-500">{language}</span>
          <CopyButton text={raw} />
        </span>
      </div>
      <pre className="max-h-[320px] overflow-auto p-3 font-mono text-[11.5px] leading-relaxed text-zinc-800">{raw}</pre>
    </div>
  );
}

function formatIssuePath(path: string): { fileLine: string; field: string } {
  // Path is either "factory.yaml:12 — repositories.0.owner" or "factory.yaml.repositories.0.owner"
  if (path.includes(" — ")) {
    const [fileLine, ...rest] = path.split(" — ");
    return { fileLine: fileLine ?? path, field: rest.join(" — ") };
  }
  if (path.includes(":")) {
    // file:line without em dash (yaml syntax error)
    const lastDot = path.lastIndexOf(":");
    // Keep whole as fileLine, no field
    if (lastDot !== -1) return { fileLine: path, field: "" };
  }
  return { fileLine: path, field: "" };
}

function getIssuePriority(issue: { code?: string }): number {
  const c = issue.code ?? "";
  if (c === "yaml_syntax" || c === "frontmatter_syntax") return 0;
  if (c === "reasoningLevel_only_codex") return 1;
  if (c === "free_only_oz") return 2;
  if (c === "exactly_one_foreman" || c === "foreman_count") return 3;
  if (c === "scorer_invariant") return 4;
  if (c === "missing_runner") return 5;
  if (c.includes("proto")) return 6;
  return 10;
}

function sortWorstFirst<T extends { code?: string }>(issues: T[]): T[] {
  return [...issues].sort((a, b) => getIssuePriority(a) - getIssuePriority(b));
}

export function ValidationPage() {
  const defaultYaml = useMemo(() => SAMPLE_FACTORY_MINIMAL, []);
  const [yamlInput, setYamlInput] = useState(defaultYaml);
  const [liveResult, setLiveResult] = useState(() => validateWithParser(defaultYaml));
  const [showRawBundleResult, setShowRawBundleResult] = useState<ReturnType<FactoryRegistry["parseBundle"]> | null>(null);

  function handleValidate() {
    const res = validateWithParser(yamlInput);
    setLiveResult(res);
    // Also demo FactoryRegistry full bundle validation (factory.yaml + foreman) — DIP
    const registry = new FactoryRegistry();
    const bundleRes = registry.parseBundle({
      factoryYaml: { raw: yamlInput, file: "factory.yaml" },
      agents: [{ raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" }],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [{ raw: SAMPLE_AUTOMATION_LABELED, file: "automations/labeled-issue/automation.md" }],
      scorers: [{ raw: SAMPLE_SCORER_TESTS, file: "scorers/tests-run/scorer.md" }],
    });
    setShowRawBundleResult(bundleRes);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-panel">
      <div className="flex h-[44px] shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-white px-4 text-[13px]">
        <span className="font-medium text-zinc-900">wilson</span>
        <span className="text-zinc-400">›</span>
        <span className="font-medium text-zinc-900">Validation</span>
        <span className="ml-2 rounded-full bg-zinc-900 px-1.5 py-0.5 text-[11px] font-medium text-white">WarpFactories.md §7 §16 + E06 US-059</span>
      </div>

      <div className="mx-auto w-full max-w-[1080px] p-4">
        <div className="mb-4">
          <h2 className="text-[18px] font-[650] tracking-[-0.02em] text-zinc-900">Validation & Schemas</h2>
          <p className="mt-1 text-[12.5px] leading-snug text-zinc-500">
            Warp publica JSON Schema generado del mismo parser que valida los archivos (<span className="font-mono">{SCHEMA_AUTH}</span> — editores y agents validan sin login) + tool <span className="font-mono">{VALIDATE_TOOL}</span> vía Factory MCP. Estático con sentido — usa nombres exactos y <span className="font-mono">FactoryRegistry</span> para live validation.
          </p>
        </div>

        <div className="space-y-4">
          {/* Schemas */}
          <section className="rounded-[12px] border border-zinc-200 bg-white p-4 shadow-sm">
            <h3 className="text-[13px] font-[650] tracking-[-0.01em] text-zinc-900">Machine-readable schema — unauthenticated (§7)</h3>
            <p className="mt-1 text-[11.5px] text-zinc-500">Warp publica JSON Schema generado del mismo parser que valida los archivos (unauthenticated — editores y agents validan sin login):</p>
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">{SCHEMA_AUTH}</span>
                <a href={SCHEMA_URLS.base} target="_blank" rel="noreferrer noopener" className="font-mono text-[11.5px] text-violet-700 hover:underline">
                  {SCHEMA_URLS.base}
                </a>
                <span className="text-[11px] text-zinc-500">(versiones soportadas)</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">{SCHEMA_AUTH}</span>
                <a href={SCHEMA_URLS.v1alpha1} target="_blank" rel="noreferrer noopener" className="font-mono text-[11.5px] text-violet-700 hover:underline">
                  {SCHEMA_URLS.v1alpha1}
                </a>
                <span className="text-[11px] text-zinc-500">(docs de v1alpha1)</span>
              </div>
              <p className="text-[11px] text-zinc-500">
                Endpoints schemas son <span className="font-medium text-zinc-700">unauthenticated</span>. Factory MCP endpoint:{" "}
                <a href={FACTORY_MCP_ENDPOINT} target="_blank" rel="noreferrer noopener" className="font-mono text-violet-700 hover:underline">
                  {FACTORY_MCP_ENDPOINT}
                </a>{" "}
                (streamable HTTP).
              </p>
            </div>
          </section>

          {/* Tool */}
          <section className="rounded-[12px] border border-zinc-200 bg-white p-4 shadow-sm">
            <h3 className="text-[13px] font-[650] tracking-[-0.01em] text-zinc-900">Tool validate_factory_files — §7 & §12</h3>
            <p className="mt-1 text-[11.5px] text-zinc-500">Validación sin guardar vía Factory MCP:</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
                <span className="font-mono text-[12px] text-zinc-900">{VALIDATE_TOOL}</span>
                <p className="mt-1 text-[11px] text-zinc-600">Valida un complete factory file tree sin guardar/aplicar. Server resuelve refs y annota file+line.</p>
              </div>
              <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
                <span className="font-mono text-[12px] text-zinc-900">{GET_SCHEMA_TOOL}</span>
                <p className="mt-1 text-[11px] text-zinc-600">Retorna current schemas para factory config files.</p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">En TermCanvas Web: usa FactoryRegistry.parseBundle (mismo parser) para validación live sin backend — DIP, no mock de red.</p>
          </section>

          {/* Fixtures 00/01/02/03/04/06/07 */}
          <section className="rounded-[12px] border border-zinc-200 bg-white p-4 shadow-sm">
            <h3 className="text-[13px] font-[650] tracking-[-0.01em] text-zinc-900">Fixtures warp-factory-examples 00/01/02/03/04/06/07 (§16 Referencias)</h3>
            <p className="mt-1 text-[11.5px] text-zinc-500">
              Repo canónico: <a href="https://github.com/warpdotdev/warp-factory-examples" target="_blank" rel="noreferrer noopener" className="font-mono text-violet-700 hover:underline">warpdotdev/warp-factory-examples</a> — ya existen como <span className="font-mono">SAMPLE_*</span> fixtures locales.
            </p>
            <div className="mt-3 overflow-hidden rounded-[8px] border border-zinc-200">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-zinc-50 text-[11px] font-[600] uppercase tracking-[0.06em] text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Ejemplo</th>
                    <th className="px-3 py-2">Qué muestra</th>
                    <th className="px-3 py-2">Fixture</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {WARP_FACTORY_EXAMPLES.map((ex) => (
                    <tr key={ex.id}>
                      <td className="px-3 py-2">
                        <a href={ex.githubUrl} target="_blank" rel="noreferrer noopener" className="font-mono text-[11.5px] text-violet-700 hover:underline">
                          {ex.id}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-zinc-700">{ex.description}</td>
                      <td className="px-3 py-2">
                        <span className={["rounded px-1.5 py-0.5 text-[11px] font-medium", ex.hasLocalFixture ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"].join(" ")}>{ex.hasLocalFixture ? "SAMPLE_* ✓" : "—"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">05 no existe en doc — set pedido es 00/01/02/03/04/06/07. Ver tablas §7 Estructura de directorios y §16 Repo de ejemplos canónicos.</p>
          </section>

          {/* Live validation */}
          <section className="rounded-[12px] border border-zinc-200 bg-white p-4 shadow-sm">
            <h3 className="text-[13px] font-[650] tracking-[-0.01em] text-zinc-900">Validación live — factory.yaml de ejemplo (FactoryRegistry)</h3>
            <p className="mt-1 text-[11.5px] text-zinc-500">
              DIP: lee de <span className="font-mono">FactoryRegistry</span>. Edita el YAML y valida — usa mismo parser que <span className="font-mono">{SCHEMA_URLS.v1alpha1}</span> y <span className="font-mono">{VALIDATE_TOOL}</span> con <span className="font-mono">file:line</span> real via <span className="font-mono">yaml LineCounter</span>. Soporta <span className="font-mono">factory.yaml</span> + <span className="font-mono">agents/*</span> + <span className="font-mono">automations/*</span> + <span className="font-mono">runners/*</span> + <span className="font-mono">scorers/*</span> + <span className="font-mono">skills/*</span> — 6 artefactos.
            </p>
            <div className="mt-3 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
              <div>
                <label htmlFor="factory-yaml-live" className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">
                  factory.yaml (prueba romperlo)
                </label>
                <textarea
                  id="factory-yaml-live"
                  value={yamlInput}
                  onChange={(e) => setYamlInput(e.target.value)}
                  rows={10}
                  className="mt-1 w-full rounded-[8px] border border-zinc-300 bg-white p-2.5 font-mono text-[11.5px] leading-relaxed text-zinc-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                  spellCheck={false}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={handleValidate} className="rounded-[8px] bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-zinc-800" type="button">
                    Validar
                  </button>
                  <button
                    onClick={() => {
                      setYamlInput(defaultYaml);
                      setLiveResult(validateWithParser(defaultYaml));
                      setShowRawBundleResult(null);
                    }}
                    className="rounded-[8px] border border-zinc-200 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-700 hover:bg-zinc-50"
                    type="button"
                  >
                    Reset válido
                  </button>
                  <button
                    onClick={() => setYamlInput((prev) => prev + "\nalias: bad@alias!!!\n")}
                    className="rounded-[8px] border border-zinc-200 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-700 hover:bg-zinc-50"
                    type="button"
                  >
                    Inyectar alias inválido
                  </button>
                </div>
              </div>
              <div>
                <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Resultado — FactoryParser + FactoryRegistry (worst-first)</div>
                <div className={["mt-1 rounded-[8px] border px-3 py-2", liveResult.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"].join(" ")}>
                  {liveResult.ok ? (
                    <p className="text-[12px] font-medium text-emerald-700">✓ valid — qué aplicaría: atómico, factory sigue en última válida si falla (WarpFactories.md §7 PR checks)</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {sortWorstFirst(liveResult.issues).map((iss, i) => {
                        const { fileLine, field } = formatIssuePath(iss.file);
                        const hasLine = fileLine.includes(":");
                        return (
                          <li key={i} className="flex gap-2 font-mono text-[11.5px] leading-snug">
                            <span className={hasLine ? "shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800" : "shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600"}>
                              {fileLine}
                            </span>
                            {hasLine ? <CopyFileLineButton fileLine={fileLine} /> : null}
                            <span className="text-red-700">
                              {field ? <span className="font-semibold">{field} · </span> : null}
                              {iss.message} {iss.code ? <span className="text-[10px] text-red-500">({iss.code})</span> : null}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-zinc-500">
                  Cada PR contra <span className="font-mono">main</span> recibe check <span className="font-mono">warp/factory-config</span>: annota fields inválidos y refs con file+line, resume qué aplicaría. Merge atómico o nada — Warp-managed nunca queda inválida (valida al guardar). 6 artefactos con <span className="font-mono">file:line</span> y sort worst-first.
                </p>
                {showRawBundleResult && (
                  <div className="mt-3 rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <div className="text-[11px] font-[600] text-zinc-700">FactoryRegistry.parseBundle (factory.yaml + foreman + runner + automation + scorer) — file+line contract §7</div>
                    {showRawBundleResult.ok ? (
                      <p className="mt-1 text-[11px] text-emerald-700">✓ bundle ok — factory {showRawBundleResult.value?.factory.name} · agents {showRawBundleResult.value?.agents.length} · runners {showRawBundleResult.value?.runners.length}</p>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {sortWorstFirst(showRawBundleResult.issues as unknown as { path: string; message: string; code: string }[]).map((iss, i) => {
                          const { fileLine, field } = formatIssuePath(iss.path);
                          return (
                            <li key={i} className="flex gap-1.5 font-mono text-[11px] leading-snug text-red-600">
                              <span className="shrink-0 rounded bg-red-100 px-1 py-0.5 text-[10px] font-bold text-red-800">{fileLine}</span>
                              <CopyFileLineButton fileLine={fileLine} />
                              <span>{field ? `${field} · ` : ""}{iss.message} <span className="text-[10px] text-red-400">({iss.code})</span></span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* PR check simulation — warp/factory-config atómico (GP2) */}
          <section className="rounded-[12px] border border-zinc-200 bg-white p-4 shadow-sm">
            <h3 className="text-[13px] font-[650] tracking-[-0.01em] text-zinc-900">PR check — warp/factory-config · simulación atómica (US-058)</h3>
            <p className="mt-1 text-[11.5px] text-zinc-500">En GitHub-backed, cada PR contra <span className="font-mono">main</span> recibe check <span className="font-mono">warp/factory-config</span> que annota <span className="font-medium">file+line</span> y resume “qué aplicaría”. Merge es <span className="font-medium">atómico o nada</span>: si la definición es inválida, la factory sigue en última válida. Warp-managed valida al guardar y nunca queda inválida.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[8px] border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-center gap-2 text-[12px] font-[600] text-emerald-800"><span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-600 text-[11px] text-white">✓</span> PR válida — qué aplicaría</div>
                <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-[11px] text-emerald-700"><li>factory.yaml: alias `payments` ok</li><li>agents/foreman/agent.md: FOREMAN único</li><li>Warp aplica atómico en merge a main</li></ul>
              </div>
              <div className="rounded-[8px] border border-red-200 bg-red-50 p-3">
                <div className="flex items-center gap-2 text-[12px] font-[600] text-red-800"><span className="grid h-5 w-5 place-items-center rounded-full bg-red-600 text-[11px] text-white">✗</span> PR inválida — no aplica parcial</div>
                <ul className="mt-2 space-y-1 pl-5 font-mono text-[11px] text-red-700"><li>factory.yaml:12 — alias · alias_charset: alias solo [A-Za-z0-9 ._-], max 60</li><li>factory sigue en última válida hasta fix en branch</li><li>Merge bloqueado por branch protection</li></ul>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-zinc-400">Demo en esta page: rompe el YAML (Inyectar alias inválido) → verás `factory.yaml:12 — alias` con file+line y el bundle pasa a “no aplica”. Corrige → `✓ bundle ok` y “qué aplicaría” atómico.</p>
          </section>

          {/* Copyable examples 01 y 02 */}
          <section className="rounded-[12px] border border-zinc-200 bg-white p-4 shadow-sm">
            <h3 className="text-[13px] font-[650] tracking-[-0.01em] text-zinc-900">Ejemplos copiables — 01-single-repo-quickstart y 02-sdlc-issue-to-pr (§7 & §16)</h3>
            <p className="mt-1 text-[11.5px] text-zinc-500">Nombres exactos del doc. Tree mínimo y full lifecycle listos para copy-paste. Validan con mismo schema v1alpha1.</p>

            <div className="mt-3">
              <h4 className="text-[12px] font-[600] text-zinc-800">01-single-repo-quickstart — Tree mínimo working</h4>
              <p className="text-[11px] text-zinc-500">factory.yaml + 1 agent + automation + runner (WarpFactories.md §7 Solo factory.yaml + al menos un agent son required. Ejemplo mínimo: 01-single-repo-quickstart)</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {EXAMPLE_01_SINGLE_REPO_QUICKSTART.files.map((f) => (
                  <CodeBlock key={f.path} path={f.path} raw={f.raw} language={f.language} />
                ))}
              </div>
            </div>

            <div className="mt-4">
              <h4 className="text-[12px] font-[600] text-zinc-800">02-sdlc-issue-to-pr — Full lifecycle (3 runners, 2 scorers, skills)</h4>
              <p className="text-[11px] text-zinc-500">Más completo: 02-sdlc-issue-to-pr (lifecycle completo con scorers+skills). Incluye factory-wide skills y per-agent.</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {COPYABLE_EXAMPLES.find((e) => e.id === "02-sdlc-issue-to-pr")!.files.map((f) => (
                  <CodeBlock key={f.path} path={f.path} raw={f.raw} language={f.language} />
                ))}
              </div>
            </div>

            <p className="mt-3 text-[11px] text-zinc-500">
              Para agregar más fixtures sin tocar esta page: extender <span className="font-mono">validation.derive WARP_FACTORY_EXAMPLES / COPYABLE_EXAMPLES</span> — OCP.
            </p>
          </section>

          <div className="rounded-[8px] border border-dashed border-zinc-300 bg-white px-3 py-2 text-[11px] text-zinc-500">
            Ref: Schemas <span className="font-mono">{SCHEMA_URLS.base}[/v1alpha1]</span> son <span className="font-mono">{SCHEMA_AUTH}</span> — ver WarpFactories.md §7 Machine-readable schema y §16 Referencias y Ejemplos Oficiales. WarpFactories-UserStories.md E06 US-059, E07 US-064→066. Validación via <span className="font-mono">{VALIDATE_TOOL}</span> y <span className="font-mono">FactoryRegistry</span> DIP. <span className="font-mono">yaml LineCounter</span> provee file:line real — fallback a string search si no resuelve. 6 artefactos con file:line dinámico (<span className="font-mono">factory.yaml, agents/, automations/, runners/, scorers/, skills/</span>).
          </div>
        </div>
      </div>
    </div>
  );
}

export default ValidationPage;
