// Tipos compartidos del flujo de seguridad del repositorio (audit + apply).
// El script scripts/configure-github-security.mjs emite JSON con ESTA forma
// (sin poder importar TS): mantener las dos definiciones sincronizadas.

export type RepoVisibility = "public" | "private" | "internal";

export type SecurityCategory = "basic" | "recommended" | "advanced";

export type SecurityFeatureStatus = "ok" | "skip" | "error";

// Una opción configurable dentro de un feature (ej. "bloquear force-push"
// dentro del ruleset de rama). tier agrupa las opciones en la checklist:
// "recommended" (recomendadas) vs "advanced" (avanzadas, con warning).
export interface SecuritySubOption {
  id: string;
  label: string;
  description: string;
  defaultOn: boolean;
  tier: "recommended" | "advanced";
  warning?: string;
}

export interface SecurityFeature {
  id: string;
  category: SecurityCategory;
  label: string;
  description: string;
  // Puede aplicarse en este repo (visibilidad, permisos, tipo de feature).
  available: boolean;
  // El usuario puede marcarla (available && !enabled).
  selectable: boolean;
  // Ya está activa en el repo.
  enabled: boolean;
  // Motivo por el que NO se puede activar (pago, solo público, requiere PR…).
  reason: string | null;
  // Rótulo corto de estado para la checklist (null si es seleccionable).
  stateLabel: string | null;
  subOptions: SecuritySubOption[];
}

export interface SecurityRulesetInfo {
  id: number;
  name: string;
  target: string;
}

export interface SecurityAudit {
  ok: true;
  owner: string;
  repo: string;
  visibility: RepoVisibility;
  defaultBranch: string;
  isAdmin: boolean;
  hasGh: boolean;
  hasCi: boolean;
  auditedAt: number;
  existingRulesets: SecurityRulesetInfo[];
  features: SecurityFeature[];
}

export type SecurityAuditResponse = SecurityAudit | { ok: false; error: string };

export interface SecurityFeatureResult {
  id: string;
  status: SecurityFeatureStatus;
  reason: string | null;
}

export interface SecurityResult {
  timestamp: number;
  owner: string;
  repo: string;
  visibility: RepoVisibility;
  features: SecurityFeatureResult[];
  summary: { ok: number; skip: number; error: number };
}

export interface SecuritySelections {
  // ids de features a aplicar (solo los selectables en el audit).
  features: string[];
  // featureId -> ids de sub-options activadas.
  subOptions: Record<string, string[]>;
}
