import type { SkillDefinition } from "../../lib/factory/domain/skill.types";

function getScopeBadge(skill: SkillDefinition) {
  if (skill.kind === "builtin") {
    if (skill.builtinType === "github") return "builtin · github — todos los agents";
    if (skill.builtinType === "slack") return "builtin · slack — solo foreman";
    if (skill.builtinType === "linear") return "builtin · linear — tracker";
    if (skill.builtinType === "jira") return "builtin · jira — tracker";
    return "builtin";
  }
  if (skill.scope === "factoryWide") return "factory-wide — todos los agents";
  return `per-agent — solo ${skill.agentName}`;
}

function formatFrontmatterValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v, null, 2);
}

export interface SkillDetailProps {
  skill: SkillDefinition;
}

export function SkillDetail({ skill }: SkillDetailProps) {
  const scopeBadge = getScopeBadge(skill);
  const entries = Object.entries(skill.frontmatter);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="border-b border-zinc-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-[600] tracking-[-0.01em] text-zinc-900">{skill.name}</h2>
          <span className="inline-flex items-center rounded-full bg-zinc-900 px-1.5 py-0.5 text-[10px] font-[700] tracking-[0.06em] uppercase text-white">
            {skill.scope === "factoryWide" ? "factory-wide" : "per-agent"}
          </span>
          {skill.kind === "builtin" && (
            <span className="inline-flex items-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-[700] tracking-[0.06em] uppercase text-white">
              builtin
            </span>
          )}
        </div>
        <p className="mt-1 text-[12px] leading-snug text-zinc-600">{scopeBadge}</p>
        <p className="mt-1 font-mono text-[11px] text-zinc-500">{skill.path}</p>
        <p className="mt-1 text-[11px] text-zinc-500">
          Usa <span className="font-mono">SKILL.md</span> con frontmatter + argument syntax estándar.
          {skill.scope === "factoryWide" ? " Visible para todos los agents." : ` Solo visible para ${skill.agentName}.`}
        </p>
      </div>

      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2">
        <p className="text-[11px] font-medium text-amber-800">
          ¿Dónde se edita?
          <span className="font-normal text-amber-700">
            {" "}
            <strong>Warp-managed</strong>: Factory definition tab — valida y commitea en un paso.{" "}
            <strong>GitHub-backed</strong>: edita el archivo y abre PR; <span className="font-mono">warp/factory-config</span>{" "}
            valida file+line y aplica atómico al mergear.
          </span>
        </p>
        {skill.kind === "custom" && (
          <p className="mt-0.5 text-[11px] text-amber-700">
            Customs extienden el baseline (GitHub/Slack/tracker), no lo reemplazan. Un skill cambia qué sabe hacer, no qué puede
            alcanzar — el acceso sigue en <span className="font-mono">secrets</span> y <span className="font-mono">mcpServers</span>.
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="grid gap-3">
          <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
            <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Scope</p>
            <p className="mt-0.5 font-mono text-[12px] text-zinc-800">{skill.scope === "factoryWide" ? "skills/<name>/SKILL.md" : `agents/${skill.agentName}/skills/<name>/SKILL.md`}</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">Directorio decide el scoping (§5). Built-ins: GitHub para todos, Slack solo foreman, tracker si se eligió.</p>
          </div>

          <div className="rounded-[8px] border border-zinc-200 bg-white px-3 py-3">
            <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Frontmatter (SKILL.md — YAML)</p>
            {entries.length === 0 ? (
              <p className="mt-1 font-mono text-[12px] text-zinc-500">— sin frontmatter —</p>
            ) : (
              <dl className="mt-2 grid gap-1.5">
                {entries.map(([k, v]) => (
                  <div key={k} className="flex gap-2 font-mono text-[12px]">
                    <dt className="min-w-[120px] shrink-0 font-[600] text-zinc-700">{k}</dt>
                    <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-zinc-800">{formatFrontmatterValue(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <div className="rounded-[8px] border border-zinc-200 bg-white px-3 py-3">
            <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Preview body (Markdown)</p>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-zinc-800">{skill.body}</pre>
          </div>

          <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
            <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Raw SKILL.md</p>
            <pre className="mt-1 max-h-[220px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-700">{skill.raw}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SkillDetail;
