import { useEffect, useMemo, useRef, useState } from "react";
import { useIssuePlannerStore } from "../stores/issuePlannerStore";
import { buildIssueTemplateBody } from "../planner/issueTemplate.ts";
import { usePlannerModalStore } from "../stores/plannerModalStore";
import { useIssueSyncStore } from "../stores/issueSyncStore";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { PlannerTerminalPane } from "./PlannerTerminalPane";
import { markdownClassName, renderMarkdown } from "../utils/markdownClass.ts";
import {
  projectIssueNumber,
  projectRefText,
} from "../utils/planNumbers.ts";
import type {
  AuditFinding,
  IssueSeverity,
  PlanningResult,
  RoadmapProposal,
} from "../types/issuePlanning";

/*
 * Modal de Planificación — genera propuestas a partir de un roadmap o
 * hallazgos de una auditoría y crea los issues seleccionados.
 *
 * Ocupa ~90% de la ventana y funciona con el modal cerrado: la simulación
 * de la corrida y de la creación vive en el store (timers a nivel módulo),
 * así el botón de la toolbar muestra el trabajo en curso y al reabrir se
 * retoma el mismo estado.
 *
 * La fase de corrida real está conectada: startSession lanza un PTY
 * headless de opencode en el worktree activo (sin tile en la escena; el
 * modal es el único renderer) que escribe <repo>/.agents/planning/
 * plan-<timestamp>.json, y el store lo parsea al pasar a results.
 */

const SEVERITY_COLORS: Record<IssueSeverity, string> = {
  critical: "#cf222e",
  high: "#bc4c00",
  medium: "#9a6700",
  low: "#1a7f37",
};

const STATUS_COLORS: Record<string, string> = {
  Todo: "#6e7681",
  "In Progress": "#0969da",
  Done: "#1a7f37",
  Closed: "#1a7f37",
  Blocked: "#cf222e",
  Cancelled: "#cf222e",
};

const PRIORITY_COLORS: Record<string, string> = {
  P0: "#cf222e",
  P1: "#bc4c00",
  P2: "#9a6700",
  P3: "#0969da",
};

const SIZE_COLORS: Record<string, string> = {
  XS: "#1a7f37",
  S: "#2da44e",
  M: "#0969da",
  L: "#8250df",
  XL: "#cf222e",
};

const LABEL_PALETTE = [
  "#cf222e",
  "#bc4c00",
  "#9a6700",
  "#1a7f37",
  "#0969da",
  "#8250df",
  "#bf3989",
  "#57606a",
];

// Los labels no traen color propio (contrato con opencode), así que se les
// asigna uno estable derivado del nombre: el mismo label siempre pinta igual.
function labelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return LABEL_PALETTE[Math.abs(hash) % LABEL_PALETTE.length];
}

function chipStyle(color: string): React.CSSProperties {
  return { background: `${color}1f`, color };
}

function Chip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="tc-caption inline-flex items-center gap-0.5 rounded-sm px-1 py-0.5"
      style={{ ...chipStyle(color), fontSize: "var(--text-xs)" }}
    >
      {children}
    </span>
  );
}

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <div
      className="animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]"
      style={{ width: size, height: size }}
    />
  );
}

function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path
        d="M2.5 6.3 5 8.5l4.5-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function rowTitle(result: PlanningResult, index: number): string {
  return result.mode === "roadmap"
    ? (result.proposals[index]?.title ?? "")
    : (result.findings[index]?.title ?? "");
}

interface CardRelationship {
  text: string;
  color: string;
}

interface CardIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  size: string | null;
  priority: string;
  status: string;
  relationships: CardRelationship[];
  // Advertencias de deduplicación: índice del item canónico del mismo
  // plan, o número de un issue REAL ya abierto que cubre el problema.
  duplicateOf?: number;
  existingIssueNumber?: number;
}

const SEVERITY_TO_PRIORITY: Record<IssueSeverity, string> = {
  critical: "P0",
  high: "P1",
  medium: "P2",
  low: "P3",
};

// Normaliza ambas fuentes (roadmap / auditoría) al mismo modelo de card:
// la auditoría no trae size/status/relationships, así que se derivan
// (severity → priority, estado inicial "Todo").
function toCardIssue(
  result: PlanningResult,
  index: number,
  resolveNumber: (planIndex: number) => number,
  refText: (planIndex: number) => string,
): CardIssue {
  if (result.mode === "roadmap") {
    const p = result.proposals[index];
    const children = result.proposals
      .map((q, i) => (q.parent === index ? i : -1))
      .filter((i) => i >= 0);
    const relationships: CardRelationship[] = [];
    if (p.blockedBy.length > 0) {
      relationships.push({
        text: `⛔ bloqueado por ${p.blockedBy.map((b) => refText(b)).join(", ")}`,
        color: "#cf222e",
      });
    }
    if (p.blocking.length > 0) {
      relationships.push({
        text: `🔒 bloquea a ${p.blocking.map((b) => refText(b)).join(", ")}`,
        color: "#0969da",
      });
    }
    if (p.parent !== undefined) {
      relationships.push({ text: `📁 hijo de ${refText(p.parent)}`, color: "#8250df" });
    }
    if (children.length > 0) {
      relationships.push({
        text: `📁 padre de ${children.map((c) => refText(c)).join(", ")}`,
        color: "#8250df",
      });
    }
    if (p.related && p.related.length > 0) {
      relationships.push({
        text: `∥ relacionado con ${p.related.map((r) => refText(r)).join(", ")}`,
        color: "#57606a",
      });
    }
    return {
      number: resolveNumber(index),
      title: p.title,
      body: p.body,
      labels: p.labels,
      size: p.size,
      priority: p.priority,
      status: p.status,
      relationships,
      duplicateOf: p.duplicateOf,
      existingIssueNumber: p.existingIssueNumber,
    };
  }

  const f = result.findings[index];
  return {
    number: resolveNumber(index),
    title: f.title,
    body: f.description,
    labels: f.labels ?? [],
    size: null,
    priority: SEVERITY_TO_PRIORITY[f.severity],
    status: "Todo",
    relationships: [],
    duplicateOf: f.duplicateOf,
    existingIssueNumber: f.existingIssueNumber,
  };
}

function Separator() {
  return <span className="tc-caption text-[var(--text-muted)]">·</span>;
}

// Cuerpo del issue renderizado: el plan JSON viene con Markdown crudo (los
// campos del template arman headers, listas y bloques de código) y sin
// renderizar es ilegible. El parse se memoiza para no re-correr marked en
// cada re-render del detalle.
function IssueBody({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div className={markdownClassName} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

interface PlanningRowProps {
  index: number;
  planResult: PlanningResult;
  selected: boolean;
  resolveNumber: (planIndex: number) => number;
  refText: (planIndex: number) => string;
  onToggle: (index: number) => void;
  onOpenDetail: (index: number) => void;
}

function PlanningRow({
  index,
  planResult,
  selected,
  resolveNumber,
  refText,
  onToggle,
  onOpenDetail,
}: PlanningRowProps) {
  const card = toCardIssue(planResult, index, resolveNumber, refText);
  // Item ya cubierto por un issue abierto del repo: no se crea de nuevo.
  // No disponible para selección, pero el detalle sigue siendo legible.
  const excluded = card.existingIssueNumber !== undefined;

  return (
    <div
      className={`tc-row-icon group w-full rounded-md flex flex-col bg-[var(--surface)] hover:bg-[var(--sidebar-hover)] ${
        selected ? "ring-1 ring-[var(--accent)]" : ""
      }`}
    >
      {/* Header: checkbox + número a la izquierda, badges de size/priority
          y flecha de detalle a la derecha. */}
      <div className="flex items-center gap-2 px-2 pt-1.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={excluded ? false : selected}
          aria-disabled={excluded}
          disabled={excluded}
          tabIndex={excluded ? -1 : 0}
          className="flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onToggle(index)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggle(index);
            }
          }}
          title={
            excluded
              ? `Ya existe el issue #${card.existingIssueNumber} en el repo — no se crea de nuevo`
              : selected
                ? "Desmarcar"
                : "Marcar para crear"
          }
        >
          <span
            aria-hidden="true"
            className={`shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
              selected
                ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-foreground)]"
                : "border-[var(--border)] text-transparent"
            }`}
          >
            <CheckIcon />
          </span>
          <span
            className="tc-caption font-medium"
            style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}
          >
            #{card.number}
          </span>
        </button>

        <div className="flex-1" />

        {card.size && (
          <Chip color={SIZE_COLORS[card.size] ?? "#57606a"}>{card.size}</Chip>
        )}
        <Chip color={PRIORITY_COLORS[card.priority] ?? "#57606a"}>
          {card.priority}
        </Chip>
        <button
          type="button"
          className="shrink-0 tc-row-icon rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
          onClick={() => onOpenDetail(index)}
          title="Ver detalle completo"
          aria-label={`Ver detalle de #${card.number} ${card.title}`}
        >
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
            <path
              d="M3 2L6.5 5L3 8"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Cuerpo: título con peso visual y preview del body a 2 líneas. */}
      <button
        type="button"
        disabled={excluded}
        className="block w-full text-left px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => onToggle(index)}
        title={
          excluded
            ? `Ya existe el issue #${card.existingIssueNumber} en el repo — no se crea de nuevo`
            : selected
              ? "Desmarcar"
              : "Marcar para crear"
        }
      >
        <div className="truncate font-semibold" style={{ fontSize: "var(--text-sm)" }}>
          {card.title}
        </div>
        <div
          className="tc-caption mt-0.5 line-clamp-2"
          style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}
        >
          {card.body}
        </div>
      </button>

      {/* Footer: labels temáticos · status · relaciones con verbo explícito. */}
      <div className="flex items-center gap-1 flex-wrap px-2 pb-1.5">
        {card.duplicateOf !== undefined && (
          <Chip color="#bf8700">
            ⚠ duplica a {refText(card.duplicateOf)}
          </Chip>
        )}
        {card.existingIssueNumber !== undefined && (
          <a
            href={`https://github.com/${planResult.repo}/issues/${card.existingIssueNumber}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex"
            onClick={(e) => e.stopPropagation()}
          >
            <Chip color="#b45300">
              ya existe #{card.existingIssueNumber}
            </Chip>
          </a>
        )}
        {card.labels.map((label) => (
          <Chip key={label} color={labelColor(label)}>
            {label}
          </Chip>
        ))}
        {card.labels.length > 0 && <Separator />}
        <Chip color={STATUS_COLORS[card.status] ?? "#57606a"}>{card.status}</Chip>
        {card.relationships.length > 0 && <Separator />}
        {card.relationships.map((rel, i) => (
          <Chip key={i} color={rel.color}>
            {rel.text}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function DetailView({
  result,
  index,
  resolveNumber,
  refTextWithTitle,
  onBack,
}: {
  result: PlanningResult;
  index: number;
  resolveNumber: (planIndex: number) => number;
  refTextWithTitle: (planIndex: number, title: string) => string;
  onBack: () => void;
}) {
  if (result.mode === "roadmap") {
    const p = result.proposals[index];
    if (!p) return null;
    const relatedTitle = (i: number) => result.proposals[i]?.title ?? "";
    const repoUrl = `https://github.com/${result.repo}`;
    const backRef = (warn: { kind: "dup" | "existing"; ref: number }) => (
      <Chip color="#bf8700">
        {warn.kind === "dup"
          ? `⚠ duplica a ${refTextWithTitle(warn.ref, relatedTitle(warn.ref))}`
          : `ya existe #${warn.ref} en el repo`}
      </Chip>
    );
    return (
      <DetailShell title={`#${resolveNumber(index)} · ${p.title}`} onBack={onBack}>
        <div className="rounded-md border border-[var(--border)] p-3">
          <div className="flex flex-wrap gap-1 mb-2">
            {(p.duplicateOf !== undefined || p.existingIssueNumber !== undefined) && (
              <span className="w-full">
                {p.duplicateOf !== undefined && backRef({ kind: "dup", ref: p.duplicateOf })}
                {p.existingIssueNumber !== undefined && backRef({ kind: "existing", ref: p.existingIssueNumber })}
              </span>
            )}
            <Chip color={STATUS_COLORS[p.status] ?? "#57606a"}>Status: {p.status}</Chip>
            <Chip color={PRIORITY_COLORS[p.priority] ?? "#57606a"}>Priority: {p.priority}</Chip>
            <Chip color={SIZE_COLORS[p.size] ?? "#57606a"}>Size: {p.size}</Chip>
            {p.parent !== undefined && (
              <Chip color="#57606a">Parent: {refTextWithTitle(p.parent, relatedTitle(p.parent))}</Chip>
            )}
            {p.blockedBy.length > 0 && (
              <Chip color="#cf222e">
                ⏸ Bloqueado por {p.blockedBy.map((b) => refTextWithTitle(b, relatedTitle(b))).join(", ")}
              </Chip>
            )}
            {p.blocking.length > 0 && (
              <Chip color="#0969da">
                → Bloquea {p.blocking.map((b) => refTextWithTitle(b, relatedTitle(b))).join(", ")}
              </Chip>
            )}
          </div>
          <IssueBody
            text={
              p.template
                ? buildIssueTemplateBody(p.body, p.template, repoUrl)
                : p.body
            }
          />
        </div>
        {p.labels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {p.labels.map((label) => (
              <Chip key={label} color={labelColor(label)}>
                {label}
              </Chip>
            ))}
          </div>
        )}
      </DetailShell>
    );
  }

  const f = result.findings[index];
  if (!f) return null;
  const repoUrl = `https://github.com/${result.repo}`;
  return (
    <DetailShell title={`#${resolveNumber(index)} · ${f.title}`} onBack={onBack}>
      <div className="rounded-md border border-[var(--border)] p-3">
        <div className="flex flex-wrap gap-1 mb-2">
          {(f.duplicateOf !== undefined || f.existingIssueNumber !== undefined) && (
            <span className="w-full">
              {f.duplicateOf !== undefined && (
                <Chip color="#bf8700">
                  ⚠ duplica a {refTextWithTitle(f.duplicateOf, result.findings[f.duplicateOf]?.title ?? "")}
                </Chip>
              )}
              {f.existingIssueNumber !== undefined && (
                <Chip color="#b45300">ya existe #{f.existingIssueNumber} en el repo</Chip>
              )}
            </span>
          )}
          <span
            className="tc-caption px-1 rounded"
            style={{ color: SEVERITY_COLORS[f.severity], background: "var(--surface-hover)" }}
          >
            Severidad: {f.severity}
          </span>
          <span className="tc-caption px-1 rounded bg-[var(--surface-hover)] text-[var(--text-secondary)]">
            Archivo: {f.file}:{f.line}
          </span>
        </div>
        <IssueBody
          text={
            f.template
              ? buildIssueTemplateBody(f.description, f.template, repoUrl)
              : f.description
          }
        />
      </div>
      {(f.labels?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1">
          {(f.labels ?? []).map((label) => (
            <Chip key={label} color={labelColor(label)}>
              {label}
            </Chip>
          ))}
        </div>
      )}
    </DetailShell>
  );
}

function DetailShell({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2 shrink-0">
        <button
          type="button"
          className="tc-row-icon inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
          onClick={onBack}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M7 2L3 5L7 8"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Volver a resultados
        </button>
        <div className="tc-caption flex-1 truncate text-[var(--text-primary)]" style={{ fontSize: "var(--text-sm)" }}>
          {title}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-2">{children}</div>
    </div>
  );
}

export function PlannerModal() {
  const store = useIssuePlannerStore();
  const {
    mode,
    roadmapText,
    phase,
    result,
    selected,
    createProgress,
    nextIssueNumber,
    confirmDiscard,
    detailIndex,
    sessionRuntime,
  } = store;
  const closePlanner = usePlannerModalStore((s) => s.closePlanner);
  useBodyScrollLock(true);

  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // El cronómetro es display-only: la corrida la avanza el store (timers
  // de módulo) aunque este componente esté desmontado, así que al reabrir
  // el modal el contador retoma desde el tiempo real transcurrido.
  useEffect(() => {
    if (phase !== "running") return;
    const startedAt = store.startedAt ?? Date.now();
    const tick = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase, store.startedAt, store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePlanner();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closePlanner]);

  const copyAllResults = async () => {
    if (!result) return;
    const repoUrl = `https://github.com/${result.repo}`;
    const lines: string[] = [];
    if (result.mode === "roadmap") {
      result.proposals.forEach((p, i) => {
        lines.push(`## #${resolveNumber(i)} ${p.title}`);
        lines.push("");
        lines.push(
          p.template
            ? buildIssueTemplateBody(p.body, p.template, repoUrl)
            : p.body,
        );
        lines.push("");
        lines.push(
          `Labels: ${p.labels.join(", ") || "—"} | Status: ${p.status} | Priority: ${p.priority} | Size: ${p.size}`,
        );
        if (p.parent !== undefined) {
          lines.push(`Parent: ${refTextWithTitle(p.parent, result.proposals[p.parent]?.title ?? "")}`);
        }
        lines.push(
          `Blocked by: ${p.blockedBy.length ? p.blockedBy.map((b) => refTextWithTitle(b, result.proposals[b]?.title ?? "")).join(", ") : "—"} | Blocking: ${p.blocking.length ? p.blocking.map((b) => refTextWithTitle(b, result.proposals[b]?.title ?? "")).join(", ") : "—"}`,
        );
        lines.push("");
      });
    } else {
      result.findings.forEach((f, i) => {
        lines.push(`## #${resolveNumber(i)} ${f.title}`);
        lines.push("");
        lines.push(
          f.template
            ? buildIssueTemplateBody(f.description, f.template, repoUrl)
            : f.description,
        );
        lines.push("");
        lines.push(`Severity: ${f.severity} | File: ${f.file}:${f.line}`);
        lines.push("");
      });
    }
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const totalCount = result
    ? result.mode === "roadmap"
      ? result.proposals.length
      : result.findings.length
    : 0;
  const usableCount = selected.length;
  const doneCount = createProgress.filter((p) => p.state === "done").length;
  // Seleccionados que aún no se crearon: al volver atrás tras una creación,
  // los done siguen en selected pero no deben volver a crearse.
  const pendingCount = selected.filter(
    (i) => !createProgress.some((p) => p.index === i && p.state === "done"),
  ).length;
  const showPercentage =
    createProgress.length > 0
      ? Math.round((doneCount / createProgress.length) * 100)
      : 0;
  const creatingPosition = createProgress.findIndex((p) => p.state === "creating");
  const hasFailed = createProgress.some((p) => p.state === "error");

  // Seleccionados con aviso de duplicado (mismo problema ya cubierto por
  // otro item del plan o por un issue abierto del repo): se crean igual si
  // el usuario lo confirma, pero se le avisa antes de apretar el botón.
  const dupeWarnCount = result
    ? selected.filter((i) => {
        const item =
          result.mode === "roadmap" ? result.proposals[i] : result.findings[i];
        return (
          item !== undefined &&
          (item.duplicateOf !== undefined || item.existingIssueNumber !== undefined)
        );
      }).length
    : 0;

  // Índices creables: los items ya cubiertos por un issue abierto
  // (existingIssueNumber) no se pueden seleccionar ni crear — el trabajo
  // ya está pedido en el repo. "Seleccionar todos" saltea estos índices.
  const selectable = result
    ? Array.from({ length: totalCount }, (_, i) => i).filter((i) => {
        const item =
          result.mode === "roadmap" ? result.proposals[i] : result.findings[i];
        return item?.existingIssueNumber === undefined;
      })
    : [];

  // Números de GitHub visibles para los items del plan: reales si ya se
  // crearon, proyectados por posición en la cola de creación si están
  // seleccionados, e índice local en el resto (ver planNumbers.ts).
  const projection = { nextIssueNumber, createProgress, selected };
  const resolveNumber = (planIndex: number) =>
    projectIssueNumber(projection, planIndex);
  const refText = (planIndex: number) =>
    projectRefText(projection, planIndex, (i) =>
      result
        ? result.mode === "roadmap"
          ? result.proposals[i]?.title
          : result.findings[i]?.title
        : undefined,
    );

  // Referencia con título adjunto (detalle y copiar todo): "#49 Vista
  // calendario", o el «título» solo cuando no se creará.
  const refTextWithTitle = (planIndex: number, title: string): string => {
    const ref = refText(planIndex);
    return ref.startsWith("#") ? `${ref} ${title}`.trim() : ref;
  };

  const discardAction = useRef<"mode" | "rerun">(null);
  // Modo al que se quiere pasar mientras la sesión corre: se cancela la
  // corrida actual con confirmación del usuario antes de aplicar el cambio.
  const [pendingMode, setPendingMode] = useState<typeof mode | null>(null);

  const startAttempt = () => {
    if (phase === "results" || phase === "creating" || phase === "summary") {
      discardAction.current = "rerun";
      store.askDiscard();
      return;
    }
    void store.startSession();
  };

  const changeModeAttempt = (next: typeof mode) => {
    if (phase === "results" || phase === "creating" || phase === "summary") {
      discardAction.current = "mode";
      store.askDiscard();
      return;
    }
    if (phase === "running") {
      setPendingMode(next);
      return;
    }
    store.setMode(next);
  };

  const onConfirmModeSwitch = () => {
    const next = pendingMode;
    setPendingMode(null);
    if (!next) return;
    store.cancelSession();
    store.setMode(next);
  };

  const onConfirmDiscard = () => {
    const action = discardAction.current;
    if (action === "rerun") {
      store.confirmDiscardChoice(true);
      void store.startSession();
    } else {
      store.confirmDiscardChoice(true);
      store.setMode(mode === "roadmap" ? "audit" : "roadmap");
    }
  };

  const busy = phase === "running" || phase === "creating";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[var(--scrim)] tc-enter-fade"
      role="dialog"
      aria-modal="true"
      aria-label="Planificación de issues"
      onClick={(e) => {
        if (e.target === e.currentTarget) closePlanner();
      }}
    >
      <div className="tc-enter-fade-up flex h-[min(84vh,900px)] w-[min(calc(100vw-6vw),1500px)] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl"
        style={{ maxHeight: "84vh" }}>
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h2 className="tc-display flex items-center gap-2">
            Planificación de issues
            {busy && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                <Spinner size={10} /> trabajando…
              </span>
            )}
          </h2>
          <button
            type="button"
            className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors duration-quick"
            onClick={closePlanner}
            aria-label="Cerrar planificación"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Columna de config — modo / entrada. Permanece visible en
              todas las fases para cambiar de estrategia o re-correr. */}
          <aside className="w-[290px] shrink-0 border-r border-[var(--border)] bg-[var(--sidebar)] flex flex-col gap-2 p-3 overflow-y-auto">
            <div className="flex items-center gap-1">
              {(["roadmap", "audit"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`tc-row-icon flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    mode === m
                      ? "bg-[var(--surface-hover)] text-[var(--text-primary)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                  onClick={() => changeModeAttempt(m)}
                >
                  {m === "roadmap" ? "Desde roadmap" : "Auditar repositorio"}
                </button>
              ))}
            </div>

            {mode === "roadmap" && (
              <>
                <textarea
                  value={roadmapText}
                  onChange={(e) => store.setRoadmapText(e.target.value)}
                  rows={6}
                  placeholder={"Pegá el roadmap acá...\njunto a lo que quieras incluir como contexto."}
                  className="w-full resize-none rounded-md bg-[var(--surface)] px-2 py-1.5 text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-muted)]"
                  style={{ fontSize: "var(--text-sm)" }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[var(--surface-hover)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-all duration-quick hover:brightness-110"
                >
                  Subir archivo Markdown (.md)
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown,text/markdown"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    for (const file of files) {
                      void file.text().then((content) =>
                        store.addRoadmapFile({ name: file.name, content }),
                      );
                    }
                    e.target.value = "";
                  }}
                />
                {store.roadmapFiles.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {store.roadmapFiles.map((file, i) => (
                      <div
                        key={i}
                        className="tc-row-icon flex items-center gap-2 rounded-md px-2 py-1 bg-[var(--surface)]"
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[var(--text-muted)]">
                          <path
                            d="M4 2.5h5l3 3v8h-8z"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinejoin="round"
                          />
                          <path d="M9 2.5v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                        </svg>
                        <span className="tc-caption flex-1 truncate" style={{ fontSize: "var(--text-xs)" }}>
                          {file.name}
                        </span>
                        <button
                          type="button"
                          className="tc-row-icon shrink-0 text-[var(--text-muted)] hover:text-red-400 p-0.5 rounded"
                          onClick={() => store.removeRoadmapFile(i)}
                          title="Quitar archivo"
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    <div className="tc-caption px-1 text-[var(--text-muted)]" style={{ fontSize: "var(--text-xs)" }}>
                      El contenido se adjunta a la sesión para que opencode lo lea.
                    </div>
                  </div>
                )}
              </>
            )}

            {phase === "idle" ? (
              mode === "roadmap" ? (
                <button
                  type="button"
                  disabled={roadmapText.trim().length === 0 && store.roadmapFiles.length === 0}
                  onClick={() => startAttempt()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-foreground)] transition-all duration-quick hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Generar propuesta
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => startAttempt()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-foreground)] transition-all duration-quick hover:brightness-110"
                >
                  Analizar repositorio
                </button>
              )
            ) : busy ? (
              <div className="tc-caption px-1 text-[var(--text-muted)]" style={{ fontSize: "var(--text-xs)" }}>
                La sesión sigue trabajando en segundo plano. Podés cerrar esta
                ventana y el trabajo continúa.
              </div>
            ) : (
              <button
                type="button"
                onClick={() => startAttempt()}
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-foreground)] transition-all duration-quick hover:brightness-110"
              >
                Re-ejecutar análisis
              </button>
            )}

            <div className="tc-caption px-1 text-[var(--text-muted)]" style={{ fontSize: "var(--text-xs)" }}>
              Sesión de opencode visible mientras trabaja. Resultado en{" "}
              <span className="text-[var(--text-secondary)]">.agents/planning/plan-*.json</span>.
            </div>
          </aside>

          {/* Zona principal: corrida, resultados o detalle */}
          <main className="flex flex-1 min-w-0 flex-col overflow-hidden">
            {detailIndex !== null && result ? (
              <DetailView
                result={result}
                index={detailIndex}
                resolveNumber={resolveNumber}
                refTextWithTitle={refTextWithTitle}
                onBack={() => store.closeDetail()}
              />
            ) : phase === "running" ? (
              sessionRuntime ? (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex items-center gap-3 px-4 py-2 shrink-0">
                    <Spinner size={12} />
                    <div className="tc-caption flex-1">
                      {mode === "roadmap"
                        ? "Corriendo sesión de opencode con tu roadmap…"
                        : "Auditando el repositorio con una sesión de opencode…"}
                    </div>
                    <div className="tc-caption" style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
                      {elapsed}s · {sessionRuntime.outputPath.split(/[\\/]/).pop()}
                    </div>
                    <button
                      type="button"
                      onClick={() => store.cancelSession()}
                      className="tc-row-icon inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--surface-hover)]"
                      title="Cerrar la sesión y cancelar"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                      Cancelar sesión
                    </button>
                  </div>
                  <div className="flex flex-col flex-1 min-h-0 px-2 pb-2">
                    <div
                      className="relative flex-1 min-h-0 overflow-hidden rounded-md border border-[var(--border)] bg-[#0d1117]"
                      style={{ fontFamily: '"Geist Mono", monospace', fontSize: "var(--text-xs)" }}
                    >
                      <PlannerTerminalPane terminalId={sessionRuntime.terminalId} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 px-4 py-6 text-center flex-1">
                  <Spinner size={22} />
                  <div className="tc-caption">
                    {mode === "roadmap"
                      ? "Corriendo sesión de opencode con tu roadmap…"
                      : "Auditando el repositorio con una sesión de opencode…"}
                  </div>
                  <div className="tc-caption" style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
                    {elapsed}s … escribiendo plan&#8209;{new Date(store.startedAt ?? Date.now()).toISOString().slice(0, 19).replace(/[^0-9]/g, "")}.json
                  </div>
                </div>
              )
            ) : phase === "results" && result ? (
              <div className="flex flex-col flex-1 min-h-0">
                <div className="flex items-center gap-2 px-4 py-2 shrink-0">
                  <div className="tc-caption flex-1 text-[var(--text-muted)]" style={{ fontSize: "var(--text-xs)" }}>
                    {totalCount} {result.mode === "roadmap" ? "propuestas" : "hallazgos"} · {usableCount} seleccionados
                    {selectable.length < totalCount && (
                      <> · {totalCount - selectable.length} ya existen en el repo</>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      store.multiSelect(
                        usableCount === selectable.length ? [] : selectable,
                      )
                    }
                    className="tc-row-icon inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                    title={
                      usableCount === selectable.length
                        ? "Quitar la selección"
                        : "Seleccionar todos los resultados disponibles"
                    }
                  >
                    {usableCount === selectable.length ? (
                      "Quitar selección"
                    ) : (
                      <>
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                          <path
                            d="M2.5 3h11v10h-11z"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M5 8l2 2 4-4"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        Seleccionar todos
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyAllResults()}
                    className="tc-row-icon inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                    title="Copiar todos los issues al portapapeles"
                  >
                    {copied ? (
                      <span className="text-[var(--accent)]">Copiado ✓</span>
                    ) : (
                      <>
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                          <path
                            d="M5 3.5h7.5v7.5H5z"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M3.5 5v7.5h7.5"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinejoin="round"
                          />
                        </svg>
                        Copiar todo
                      </>
                    )}
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-2 flex flex-col gap-1">
                  {Array.from({ length: totalCount }).map((_, i) => (
                    <PlanningRow
                      key={i}
                      planResult={result}
                      index={i}
                      selected={selected.includes(i)}
                      resolveNumber={resolveNumber}
                      refText={refText}
                      onToggle={store.toggleSelect}
                      onOpenDetail={(idx) => store.openDetail(idx)}
                    />
                  ))}
                </div>
                <div className="shrink-0 border-t border-[var(--border)] px-4 py-2 flex flex-col gap-2">
                  {dupeWarnCount > 0 && (
                    <div className="tc-caption" style={{ color: "#bf8700" }}>
                      ⚠ {dupeWarnCount} seleccionado{dupeWarnCount !== 1 ? "s" : ""} marcad{dupeWarnCount !== 1 ? "os" : "o"} como posible{dupeWarnCount !== 1 ? "s" : ""} duplicado{dupeWarnCount !== 1 ? "s" : ""} (repite un problema ya cubierto por otro item o por un issue abierto del repo).
                    </div>
                  )}
                  {hasFailed && (
                    <div className="tc-caption text-[var(--text-muted)]">
                      Algunos issues no se pudieron crear. Los ya creados no se
                      duplican al reintentar.
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={pendingCount === 0}
                    onClick={() => store.startCreate()}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-foreground)] transition-all duration-quick hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {hasFailed
                      ? "Reintentar creación"
                      : pendingCount > 0
                        ? `Crear ${pendingCount} issue${pendingCount !== 1 ? "s" : ""} seleccionado${pendingCount !== 1 ? "s" : ""}`
                        : "Todos los seleccionados ya fueron creados"}
                  </button>
                </div>
              </div>
            ) : phase === "creating" && result ? (
              <div className="flex flex-col flex-1 min-h-0 overflow-y-auto gap-1 p-4">
                <div className="flex items-center gap-2">
                  <div className="tc-caption flex-1 text-[var(--text-muted)]">
                    Creando issues ({usableCount})…
                  </div>
                  <div className="tc-caption" style={{ color: "var(--accent)", fontSize: "var(--text-xs)" }}>
                    {showPercentage}%
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--surface)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)] transition-all duration-300"
                    style={{ width: `${showPercentage}%` }}
                  />
                </div>
                <div className="py-2 flex flex-col gap-1.5">
                  {createProgress.map((progress, i) => {
                    const itemTitle = rowTitle(result, progress.index);
                    const itemState =
                      progress.state === "done"
                        ? "done"
                        : creatingPosition === i
                          ? "creating"
                          : progress.state;
                    return (
                      <div key={i} className="flex items-center gap-2 text-[12px]">
                        <span
                          className="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0"
                          style={{
                            borderColor:
                              itemState === "done" ? "var(--accent)" : "var(--border)",
                            color: "var(--accent-foreground)",
                            background: itemState === "done" ? "var(--accent)" : "transparent",
                          }}
                        >
                          {itemState === "done" && <CheckIcon size={10} />}
                          {itemState === "creating" && <Spinner size={10} />}
                        </span>
                        <span
                          className="truncate flex-1"
                          style={{
                            color:
                              itemState === "done"
                                ? "var(--text-secondary)"
                                : "var(--text-secondary)",
                            textDecoration: itemState === "done" ? "line-through" : "none",
                          }}
                        >
                          {itemTitle}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : phase === "summary" && result ? (
              <div className="flex flex-col items-center justify-center gap-3 px-4 py-6 text-center flex-1">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
                >
                  <CheckIcon size={16} />
                </div>
                <div className="tc-caption">
                  {usableCount} issues creados en {result.repo}
                </div>
                <div className="flex flex-col gap-1 w-full max-w-xl px-2">
                  {createProgress
                    .filter((p) => p.state === "done")
                    .map((p, i) => (
                      <a
                        key={i}
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="tc-caption rounded-md px-2 py-1 bg-[var(--surface-hover)] text-[var(--accent)] hover:underline text-center"
                      >
                        {p.number !== undefined
                          ? `#${p.number} · ${rowTitle(result, p.index)}`
                          : p.url}
                      </a>
                    ))}
                </div>
                <div className="flex flex-col items-center gap-2 w-full max-w-xl px-2">
                  <button
                    type="button"
                    onClick={() => store.backToResults()}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--surface-hover)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] transition-all duration-quick hover:brightness-110"
                    title="Volver al plan sin descartar lo ya creado"
                  >
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M9 4L5 8l4 4"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Agregar más issues
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void useIssueSyncStore.getState().fetchIssuesHandler?.();
                      // Cierra el modal sin resetAll: el plan y su resultado
                      // persistido se conservan, así reabrir no exige re-auditar.
                      usePlannerModalStore.getState().closePlanner();
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-foreground)] transition-all duration-quick hover:brightness-110"
                  >
                    Traer issues al canvas
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center p-6 text-center">
                <div className="tc-caption" style={{ color: "var(--text-muted)" }}>
                  {mode === "roadmap"
                    ? "Pegá un roadmap o subí archivos .md y luego generá la propuesta."
                    : "Analizá el repositorio para detectar problemas como issues reproducibles."}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      <ConfirmDialog
        open={pendingMode !== null}
        title="Cambiar de modo"
        body="La sesión de análisis está corriendo. ¿Cancelarla y cambiar de modo?"
        confirmLabel="Cancelar sesión y cambiar"
        cancelLabel="Seguir esperando"
        confirmTone="danger"
        onCancel={() => setPendingMode(null)}
        onConfirm={onConfirmModeSwitch}
      />

      <ConfirmDialog
        open={confirmDiscard}
        title="Descartar resultados"
        body="Tenés resultados sin usar. ¿Descartarlos y empezar de nuevo?"
        confirmLabel="Descartar"
        cancelLabel="Cancelar"
        confirmTone="danger"
        onCancel={() => store.confirmDiscardChoice(false)}
        onConfirm={onConfirmDiscard}
      />
    </div>
  );
}