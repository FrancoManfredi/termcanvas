import type { SkillDefinition } from "../../lib/factory/domain/skill.types";

function getScopeLabel(skill: SkillDefinition): string {
  if (skill.scope === "factoryWide") return "factory-wide";
  return `per-agent · ${skill.agentName}`;
}

function getScopeColor(skill: SkillDefinition): string {
  if (skill.kind === "builtin") {
    if (skill.builtinType === "github") return "bg-zinc-800 text-white";
    if (skill.builtinType === "slack") return "bg-violet-600 text-white";
    return "bg-amber-600 text-white";
  }
  if (skill.scope === "factoryWide") return "bg-emerald-600 text-white";
  return "bg-sky-600 text-white";
}

function getKindLabel(skill: SkillDefinition): string {
  if (skill.kind === "builtin") return `builtin · ${skill.builtinType}`;
  return "custom";
}

export interface SkillCardProps {
  skill: SkillDefinition;
  selected: boolean;
  onSelect: (name: string) => void;
}

export function SkillCard({ skill, selected, onSelect }: SkillCardProps) {
  const scopeLabel = getScopeLabel(skill);
  const scopeColor = getScopeColor(skill);
  const kindLabel = getKindLabel(skill);

  return (
    <button
      onClick={() => onSelect(skill.name)}
      aria-current={selected ? "true" : undefined}
      aria-label={`Select skill ${skill.name}`}
      className={[
        "flex w-full flex-col gap-2 rounded-[10px] border px-3 py-3 text-left transition-[background-color,box-shadow,scale] duration-150",
        selected
          ? "border-violet-300 bg-violet-50 shadow-[0_1px_3px_rgba(124,58,237,0.12)]"
          : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50",
      ].join(" ")}
      style={{ willChange: "transform" }}
    >
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-[700] tracking-[0.06em] uppercase ${scopeColor}`}>
          {scopeLabel}
        </span>
        <span className="truncate text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">{skill.name}</span>
        <span className="ml-auto inline-flex rounded-full border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
          {kindLabel}
        </span>
        {selected && <span className="h-1.5 w-1.5 rounded-full bg-violet-600" aria-hidden />}
      </div>
      {skill.frontmatter.description && (
        <p className="line-clamp-2 text-[12.5px] leading-snug text-zinc-600">
          {String(skill.frontmatter.description)}
        </p>
      )}
      <span className="truncate font-mono text-[11px] text-zinc-400">{skill.path}</span>
    </button>
  );
}

export default SkillCard;
