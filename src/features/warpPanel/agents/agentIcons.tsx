import {
  BookOpen,
  Bot,
  Braces,
  Bug,
  Compass,
  Cpu,
  Database,
  Eye,
  FileCode,
  FlaskConical,
  GitBranch,
  Globe,
  Hammer,
  Rocket,
  Search,
  Shield,
  ShieldCheck,
  Terminal,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * agentIcons — set curado de íconos de agente (lucide, familia única).
 * La clave viaja en el frontmatter (`icon: shield`); desconocido o vacío =
 * monograma con la inicial del nombre. Los nombres son estables (nunca
 * renombrar una key ya persistida en agent.md).
 */

const ICON_REGISTRY: Readonly<Record<string, { icon: LucideIcon; label: string }>> = {
  bot: { icon: Bot, label: "Bot" },
  cpu: { icon: Cpu, label: "CPU" },
  terminal: { icon: Terminal, label: "Terminal" },
  wrench: { icon: Wrench, label: "Wrench" },
  hammer: { icon: Hammer, label: "Hammer" },
  shield: { icon: Shield, label: "Shield" },
  "shield-check": { icon: ShieldCheck, label: "Shield check" },
  eye: { icon: Eye, label: "Eye" },
  search: { icon: Search, label: "Search" },
  bug: { icon: Bug, label: "Bug" },
  flask: { icon: FlaskConical, label: "Flask" },
  rocket: { icon: Rocket, label: "Rocket" },
  zap: { icon: Zap, label: "Zap" },
  compass: { icon: Compass, label: "Compass" },
  book: { icon: BookOpen, label: "Book" },
  database: { icon: Database, label: "Database" },
  branch: { icon: GitBranch, label: "Branch" },
  code: { icon: FileCode, label: "Code" },
  braces: { icon: Braces, label: "Braces" },
  globe: { icon: Globe, label: "Globe" },
};

export const AGENT_ICON_KEYS: readonly string[] = Object.keys(ICON_REGISTRY);

export function isAgentIconKey(value: unknown): boolean {
  try {
    return typeof value === "string" && value.length > 0 && value in ICON_REGISTRY;
  } catch {
    return false;
  }
}

export function agentIconLabel(key: string): string {
  return ICON_REGISTRY[key]?.label ?? "None";
}

/** Ícono del agente o null (el caller dibuja el fallback monograma). */
export function AgentIcon({ icon, size = 16 }: { icon: string; size?: number }) {
  const entry = ICON_REGISTRY[icon];
  if (!entry) return null;
  const Component = entry.icon;
  return <Component size={size} strokeWidth={1.75} aria-hidden="true" />;
}

/** Grilla del picker: íconos curados + "None" (monograma). */
export function IconPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ag-icon-grid" role="radiogroup" aria-label="Agent icon">
      <button
        type="button"
        role="radio"
        aria-checked={!isAgentIconKey(value)}
        className="ag-icon-btn"
        aria-pressed={!isAgentIconKey(value)}
        title="None (initial)"
        onClick={() => onChange("")}
        disabled={disabled}
      >
        <span className="ag-icon-none" aria-hidden="true">
          A
        </span>
      </button>
      {AGENT_ICON_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          className="ag-icon-btn"
          aria-pressed={value === key}
          title={agentIconLabel(key)}
          onClick={() => onChange(key)}
          disabled={disabled}
        >
          <AgentIcon icon={key} size={16} />
        </button>
      ))}
    </div>
  );
}
