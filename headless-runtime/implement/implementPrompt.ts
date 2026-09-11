/**
 * Implement prompt — flujo simple (sin reintentos).
 * Construye prompt para ImplementAgent LLM con instrucción cambio mínimo Warp.
 * Reglas: 1-3 archivos ideal 1, agrega tests, no pnpm-lock. Sin cierre
 * máquina en el turno: la detección de archivos es 100% disco
 * (`getFilteredCreatedFiles`); ningún código parsea JSON del modelo.
 * UN solo turno por consume: si no toca archivos, el job queda parado en
 * Building (sin second pass, sin fallback fantasma).
 */

import type { ImplementInput } from "../../shared/types/implement";
import type { WorkItem } from "../../shared/types/workItem";
import { stripScopeBoilerplate } from "../../shared/scope";
import { getRunner } from "../factory/agentLoader";
import {
  TAG_IMPLEMENT_FIRST,
  tagImplementRevise,
  withPhaseTag,
} from "../llm/phaseTags";

/**
 * Etiqueta honesta del runner para el prompt (C2: cero imagen hardcodeada).
 * Fuente única: factory/runners/linux-build.yaml vía getRunner (nunca lanza).
 * Resuelve imagen + shape del yaml; ante yaml ausente/inválido degrada a
 * "(linux-build sin imagen: local)". Pura salvo lectura cacheada, nunca lanza,
 * sin loops. Otro literal de imagen acá sería regress (ver runner-source-of-truth).
 */
function resolveImplementRunnerLabel(): string {
  try {
    const def = getRunner("linux-build");
    const image = def?.platform?.dockerImage?.trim();
    const shape = def?.instanceShape;
    const shapeStr =
      shape && typeof shape.vcpus === "number" && typeof shape.memoryGb === "number"
        ? `${shape.vcpus}vCPU/${shape.memoryGb}GB`
        : null;
    if (image && shapeStr) return `(linux-build ${image} ${shapeStr})`;
    if (image) return `(linux-build ${image})`;
    return "(linux-build sin imagen: local)";
  } catch {
    return "(linux-build sin imagen: local)";
  }
}

/**
 * Build prompt for minimal change implementation (Warp).
 * Strict executor: direct order to EDIT files with tools (prose alone
 * changes nothing), required closing JSON, no side docs instead of the
 * change. Flujo simple: un solo turno, sin second pass.
 */
export function buildImplementPrompt(
  input: ImplementInput | WorkItem,
): string {
  return composeImplementPrompt(input, false);
}

/**
 * Contexto de revise (job devuelto por el reviewer): findings accionables
 * del `lastReview`. Null cuando no hay revise (primer implement). Puro,
 * nunca lanza — un feedback roto/malformado se ignora (prompt base).
 */
function readReviseContext(input: unknown): {
  summary: string;
  attempt: number | null;
  findings: Array<{
    message: string;
    severity?: string;
    file?: string;
    line?: number;
    suggestion?: string;
  }>;
} | null {
  try {
    const rec = input as Record<string, unknown>;
    const fb = rec.reviewFeedback;
    if (!fb || typeof fb !== "object" || Array.isArray(fb)) return null;
    const fbr = fb as Record<string, unknown>;
    if (typeof fbr.verdict !== "string" || fbr.verdict !== "revise") return null;
    const rawFindings = Array.isArray(fbr.findings) ? fbr.findings : [];
    const findings: Array<{
      message: string;
      severity?: string;
      file?: string;
      line?: number;
      suggestion?: string;
    }> = [];
    rawFindings.forEach((f) => {
      try {
        if (!f || typeof f !== "object" || Array.isArray(f)) return;
        const fr = f as Record<string, unknown>;
        if (typeof fr.message !== "string" || fr.message.trim() === "") return;
        const one: {
          message: string;
          severity?: string;
          file?: string;
          line?: number;
          suggestion?: string;
        } = { message: fr.message.trim().slice(0, 1000) };
        if (typeof fr.severity === "string" && fr.severity.trim() !== "") {
          one.severity = fr.severity.trim().slice(0, 20);
        }
        if (typeof fr.file === "string" && fr.file.trim() !== "") {
          one.file = fr.file.trim().slice(0, 256);
        }
        if (typeof fr.line === "number" && Number.isFinite(fr.line)) {
          one.line = Math.trunc(fr.line);
        }
        if (typeof fr.suggestion === "string" && fr.suggestion.trim() !== "") {
          one.suggestion = fr.suggestion.trim().slice(0, 1000);
        }
        findings.push(one);
      } catch {
        // un finding roto nunca aborta a los demás
      }
    });
    if (findings.length === 0) return null;
    const summary =
      typeof fbr.summary === "string" ? fbr.summary.trim().slice(0, 2000) : "";
    const attempt =
      typeof fbr.attempt === "number" && Number.isFinite(fbr.attempt)
        ? Math.trunc(fbr.attempt)
        : null;
    return { summary, attempt, findings: findings.slice(0, 20) };
  } catch {
    return null;
  }
}

function composeImplementPrompt(
  input: ImplementInput | WorkItem,
  _strict: boolean,
): string {
  const prompt = (input as { prompt: string }).prompt ?? "";
  const truncatedPrompt = stripScopeBoilerplate(prompt).slice(0, 4000);
  // Revise round: si el input trae feedback del reviewer (verdict revise +
  // findings), el prompt cambia de modo (corrige sobre lo aplicado).
  // Primer implement: null → prompt base byte-idéntico.
  const revise = readReviseContext(input);

  const reviseSection: string[] =
    revise !== null
      ? [
          `REVISE ROUND${revise.attempt !== null ? ` (tras review intento ${revise.attempt})` : ""} — ESTE NO ES EL PRIMER IMPLEMENT:`,
          "El reviewer RECHAZÓ el cambio anterior. El cambio previo SIGUE APLICADO en el worktree: trabaja SOBRE él, no lo rehagas desde cero.",
          revise.summary !== ""
            ? `Resumen del reviewer: """${revise.summary}"""`
            : "El reviewer no dejó resumen: corrige cada finding de la lista.",
          "Findings a corregir (TODOS, uno por uno):",
          ...revise.findings.map((f, i) => {
            const where =
              (f.file !== undefined ? f.file : "(archivo del cambio previo)") +
              (f.line !== undefined ? `:${f.line}` : "");
            const sev = f.severity !== undefined ? ` [${f.severity}]` : "";
            const sug =
              f.suggestion !== undefined ? ` Sugerencia: ${f.suggestion}` : "";
            return `${i + 1}.${sev} ${where} — ${f.message}.${sug}`;
          }),
          "Reglas del revise: corrige CADA finding con tools; no abras scope nuevo (solo archivos de los findings + los ya tocados); verifica que cada archivo que declares existe en disco con contenido real.",
          "",
        ]
      : [];
  // Turno único de datos: el agente (system prompt del espejo con doctrina
  // y reglas de factory/agents/implement/agent.md) ya sabe ejecutar; el
  // turno lleva datos: issue + revise (primer implement o fix del review).
  // El worktree es el directory de la sesión y el contrato de salida vive
  // en el espejo. Sin strict second pass: un turno, sin reintentos.
  const slimArr = [...reviseSection, `User prompt: """${truncatedPrompt}"""`].join("\n");
  // Etiqueta humana de fase: primer implement o ronda revise en la sesión.
  const tag =
    revise !== null
      ? tagImplementRevise(revise.attempt)
      : TAG_IMPLEMENT_FIRST;
  return withPhaseTag(slimArr, tag);
}
