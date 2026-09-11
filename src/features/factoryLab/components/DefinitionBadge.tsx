/**
 * DefinitionBadge — Ola 20 E2 (Paridad Warp: validación de definition, lado UI).
 *
 * Badge junto al `daemon <buildId>` + panel colapsable de issues. Contrato E1
 * (solo se consume, espejo estructural en `./definitionUi.ts`):
 * `GET /factory/definition/status` → `{ valid, issues, checkedAt, buildId? }`.
 *
 * - Verde `definition válida` si valid; rojo `definition: N errores` si !valid
 *   (N = solo errors); ámbar `definition: N avisos` si valid con solo warns;
 *   gris `definition: ?` si desconocida (fetch fallido o respuesta corrupta:
 *   fail-safe VISIBLE, no silencioso, sin romper la página).
 * - Panel `<details>` que lista `file:line rule message` (sin `line` →
 *   `file rule message`). `data === null` = aún no cargado o fetch fallido.
 * - CERO polling acá: el fetch vive en el tick existente de salud del daemon
 *   en `FactoryLabPage` (30s, `DEFINITION_POLL_MS`); este archivo es puramente
 *   presentacional (cero `setInterval`/`setTimeout`/`fetch`).
 *
 * ESM puro, cero `require()`.
 */

import {
  badgeForDefinitionStatus,
  formatDefinitionIssue,
} from "./definitionUi";
import type { DefinitionStatusData } from "./definitionUi";

const TONE_CLASSES: Record<string, string> = {
  green: "border-green-200 bg-green-50 text-green-800",
  red: "border-red-200 bg-red-50 text-red-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  gray: "border-zinc-200 bg-zinc-100 text-zinc-500",
};

export function DefinitionBadge(props: {
  data: DefinitionStatusData | null;
}): React.JSX.Element {
  const { data } = props;
  let view = { tone: "gray", label: "definition: ?" };
  try {
    view = badgeForDefinitionStatus(data);
  } catch {
    view = { tone: "gray", label: "definition: ?" };
  }
  const toneClass = TONE_CLASSES[view.tone] ?? TONE_CLASSES.gray;

  let issues: DefinitionStatusData["issues"] = [];
  try {
    issues = Array.isArray(data?.issues) ? (data as DefinitionStatusData).issues : [];
  } catch {
    issues = [];
  }
  let checkedAt = "";
  try {
    checkedAt =
      data && typeof data.checkedAt === "string" ? data.checkedAt : "";
  } catch {
    checkedAt = "";
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span
        role="status"
        aria-live="polite"
        title={
          checkedAt
            ? `definition status (verificado ${checkedAt})`
            : "definition status (sin datos: daemon inalcanzable o sin respuesta)"
        }
        className={`inline-flex items-center rounded-md border px-2 py-px font-mono text-[11px] font-medium ${toneClass}`}
      >
        {view.label}
      </span>
      {issues.length > 0 ? (
        <details className="relative inline-flex shrink-0">
          <summary
            aria-label={`Ver ${issues.length} issues de definition`}
            title={issues.map((i) => formatDefinitionIssue(i)).join("\n")}
            className="cursor-pointer rounded border border-zinc-200 bg-white px-1.5 py-px text-[10px] font-medium text-zinc-600 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
          >
            {issues.length} issues
          </summary>
          <div
            role="dialog"
            aria-label="Issues de definition"
            className="absolute left-0 top-6 z-50 max-h-[280px] w-[380px] overflow-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-lg"
          >
            <ul className="divide-y divide-zinc-100">
              {issues.map((issue, idx) => (
                <li
                  // eslint-disable-next-line react/no-array-index-key
                  key={`${issue.file}:${issue.rule}:${idx}`}
                  className="px-2 py-1.5 font-mono text-[10px] leading-snug text-zinc-700"
                  style={{ overflowWrap: "anywhere" }}
                  title={issue.message}
                >
                  <span
                    className={
                      issue.severity === "error"
                        ? "font-bold text-red-700"
                        : "font-bold text-amber-700"
                    }
                  >
                    [{issue.severity}]
                  </span>{" "}
                  {formatDefinitionIssue(issue)}
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}
    </span>
  );
}

export default DefinitionBadge;
