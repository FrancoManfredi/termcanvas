import { useMemo, useState } from "react";
import { useFactoryBundle } from "../../lib/factory/hooks/useFactoryBundle";
import type { SkillDefinition } from "../../lib/factory/domain/skill.types";
import { parseSkillMd, getBuiltinSkills, categorizeSkills } from "../../lib/factory/domain/skill.registry";
import { SAMPLE_SKILL_REPOSITORY_CONVENTIONS, SAMPLE_SKILL_INCIDENT_TRIAGE } from "../../lib/factory/fixtures/skill.samples";
import { SkillCard } from "./SkillCard";
import { SkillDetail } from "./SkillDetail";

function buildCustomSkills(): SkillDefinition[] {
  const inputs: { raw: string; file: string }[] = [
    { raw: SAMPLE_SKILL_REPOSITORY_CONVENTIONS, file: "skills/repository-conventions/SKILL.md" },
    { raw: SAMPLE_SKILL_INCIDENT_TRIAGE, file: "agents/foreman/skills/incident-triage/SKILL.md" },
  ];
  const out: SkillDefinition[] = [];
  for (const inp of inputs) {
    const r = parseSkillMd(inp.raw, inp.file);
    if (r.ok && r.value) out.push(r.value);
  }
  return out;
}

function getSelectedSkill(skills: SkillDefinition[], selectedName: string | null): SkillDefinition | null {
  if (!selectedName) return skills[0] ?? null;
  return skills.find((s) => s.name === selectedName) ?? skills[0] ?? null;
}

export function SkillsPage() {
  const bundleResult = useFactoryBundle();
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const { allSkills, factoryWide, perAgent, totalCount, factory } = useMemo(() => {
    const custom = buildCustomSkills();
    const factoryDef = bundleResult.ok ? bundleResult.value!.factory : undefined;
    const builtins = getBuiltinSkills(factoryDef);
    const all = [...builtins, ...custom];
    const cat = categorizeSkills(all);
    return {
      allSkills: all,
      factoryWide: cat.factoryWide,
      perAgent: cat.perAgent,
      totalCount: all.length,
      factory: factoryDef,
    };
  }, [bundleResult]);

  const selectedSkill = useMemo(() => getSelectedSkill(allSkills, selectedName), [allSkills, selectedName]);

  if (!bundleResult.ok) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
        <div className="flex h-[44px] shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-white px-4 text-[13px]">
          <span className="font-medium text-zinc-900">wilson</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Skills</span>
        </div>
        <div className="p-4 text-sm text-red-600">{bundleResult.issues.map((i) => i.message).join("; ")}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
      <div className="flex h-[44px] shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-zinc-900">wilson</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Skills</span>
          <span className="ml-2 rounded-full bg-zinc-900 px-1.5 py-0.5 text-[11px] font-medium text-white">{totalCount}</span>
        </div>
        <span className="text-[11px] font-medium text-zinc-500">Factory definition — static registry</span>
      </div>

      <div className="border-b border-zinc-200 bg-white px-4 py-3">
        <p className="text-[13px] font-medium text-zinc-900">Skills registry — factory-wide y per-agent</p>
        <p className="mt-1 text-[12px] leading-snug text-zinc-500">
          Factory: {factory!.name} · Alias: {factory!.alias ?? "—"} · Un skill es un directorio con{" "}
          <span className="font-mono">SKILL.md</span> (frontmatter + argument syntax).{" "}
          <span className="font-mono">skills/&lt;name&gt;/SKILL.md</span> → todos los agents;{" "}
          <span className="font-mono">agents/&lt;name&gt;/skills/&lt;name&gt;/SKILL.md</span> → solo ese agente. Built-ins:
          GitHub para todos, Slack solo foreman, tracker si se eligió. Customs extienden baseline, no reemplazan. Skill no amplía
          acceso — el scoping sigue en <span className="font-mono">secrets</span> y <span className="font-mono">mcpServers</span>.
        </p>
        <p className="mt-1 text-[11px] text-zinc-500">
          ¿Dónde se editan? <strong>Warp-managed</strong>: Factory definition tab. <strong>GitHub-backed</strong>: editar archivos en el repo y abrir PR.
        </p>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-zinc-200 bg-panel lg:max-w-[380px]">
          <div className="flex-1 overflow-y-auto p-3">
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 px-1 text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">
                  Factory-wide · {factoryWide.length}
                </p>
                <div className="space-y-2">
                  {factoryWide.map((skill) => (
                    <SkillCard key={skill.path} skill={skill} selected={selectedSkill?.path === skill.path} onSelect={setSelectedName} />
                  ))}
                </div>
              </div>

              {Array.from(perAgent.entries()).map(([agentName, skills]) => (
                <div key={agentName}>
                  <p className="mb-1.5 px-1 text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">
                    Per-agent · {agentName} · {skills.length}
                  </p>
                  <div className="space-y-2">
                    {skills.map((skill) => (
                      <SkillCard key={skill.path} skill={skill} selected={selectedSkill?.path === skill.path} onSelect={setSelectedName} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="hidden min-h-0 flex-1 overflow-hidden lg:flex">
          {selectedSkill ? (
            <SkillDetail skill={selectedSkill} />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-500">No skill selected</div>
          )}
        </div>
      </div>

      {selectedSkill && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-zinc-200 bg-white lg:hidden">
          <SkillDetail skill={selectedSkill} />
        </div>
      )}
    </div>
  );
}

export default SkillsPage;
