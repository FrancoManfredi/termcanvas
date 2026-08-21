// Sección POST ENTREVISTAS → Historias de Usuario.
//
// Artefacto de producto primario de la síntesis. Extraída VERBATIM del cuerpo
// de CoreArchitectureModal: grilla de tarjetas, migración legacy (backfill de
// historias con 1 llamada al motor), bloque de eliminadas/recuperables y el
// formulario add/edit en portal. El estado cruzado (síntesis, búsqueda,
// portapapeles, highlight) llega por CoreModalContext.

import { useState } from "react";
import { createPortal } from "react-dom";
import { useCoreModal } from "../context";
import { useStoryForm } from "../forms";
import { useStoryMutations, usePurge } from "../mutations";
import { NoSynthesis, SearchHeader, SynthLoading } from "../sectionChrome";
import { resolveActiveWorktree } from "../../../planner/planningSession";
import {
  AlertIcon,
  CheckIcon,
  CloseXIcon,
  CopyIcon,
  PencilIcon,
  RestoreIcon,
  TrashIcon,
  UserStoryIcon,
  priorityBadgeClass,
} from "../shared";

// Traduce los errores del motor de migración a mensajes accionables para el
// usuario. El motor ya distingue categorías (server caído, schema no cumplido,
// timeout, fallo de validación) — acá se convierten en texto amigable.
function friendlyMigrationError(raw: string): string {
  if (/no se pudo arrancar el server|no se pudo crear la sesión|error de llamada|API/i.test(raw)) {
    return "El motor de IA no está disponible. Verificá la configuración de opencode e intentá de nuevo.";
  }
  if (/no cumplió el schema|fuera de contrato|no validó el contrato/i.test(raw)) {
    return "El modelo no devolvió un formato válido. Reintentá (puede ser transitorio).";
  }
  if (/tiempo de espera|timeout|excedió el tiempo/i.test(raw)) {
    return "La migración superó el tiempo de espera. Reintentá.";
  }
  return raw || "No se pudo migrar las historias.";
}

export function UserStoriesSection() {
  const {
    synthesis,
    synthesisPath,
    synthLoading,
    applySynthesis,
    search,
    copiedId,
    copy,
    highlightStoryId,
    rfCountForStory,
  } = useCoreModal();

  const { storyForm, setStoryForm, openAddStory, openEditStory, submitStoryForm } =
    useStoryForm(synthesisPath, applySynthesis);
  const { deletingStory, setDeletingStory, storyActionBusy, confirmDeleteStory, restoreStory } =
    useStoryMutations({ synthesisPath, applySynthesis });
  const { setPurgeTarget } = usePurge({ synthesisPath, applySynthesis });

  // Migración de una síntesis legacy (sin historias): estado explícito para
  // que un fallo nunca sea silencioso — el CTA queda visible para reintentar.
  const [migrate, setMigrate] = useState<{
    phase: "idle" | "running" | "error" | "done";
    error?: string;
  }>({ phase: "idle" });

  const runMigration = async () => {
    const active = resolveActiveWorktree();
    if (!active || !synthesisPath) {
      setMigrate({ phase: "error", error: "No hay una síntesis activa para migrar." });
      return;
    }
    setMigrate({ phase: "running" });
    try {
      const res = await window.termcanvas.interview.backfillStories(active.path, synthesisPath);
      if (res.ok) {
        // Aplica la síntesis devuelta (ya migrada o reparada) directamente.
        applySynthesis(res.synthesis);
        setMigrate({ phase: "done" });
      } else {
        setMigrate({ phase: "error", error: friendlyMigrationError(res.error) });
      }
    } catch (err) {
      setMigrate({ phase: "error", error: friendlyMigrationError(err instanceof Error ? err.message : String(err)) });
    }
  };

  const [showDeleted, setShowDeleted] = useState(false);

  // ── Datos reales de la síntesis ────────────────────────────────────────
  const stories = synthesis?.historias_de_usuario ?? [];
  const deletedStories = synthesis?.historias_eliminadas ?? [];
  const hasSynthesis = synthesis !== null;

  const filteredStories = stories.filter(
    (s) =>
      s.id.toLowerCase().includes(search.toLowerCase()) ||
      s.rol.toLowerCase().includes(search.toLowerCase()) ||
      s.quiero.toLowerCase().includes(search.toLowerCase()) ||
      s.para.toLowerCase().includes(search.toLowerCase()) ||
      s.titulo.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      {synthLoading ? (
        <SynthLoading />
      ) : !hasSynthesis ? (
        <NoSynthesis />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 pb-2 border-b border-[var(--border)]">
            <span className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">
              {stories.length} activas · {deletedStories.length} eliminadas
            </span>
          </div>

          {stories.length === 0 ? (
            deletedStories.length === 0 && synthesis?.historias_backfilled !== true ? (
              /* Legacy genuino: CTA de migración (1 llamada al motor). */
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-4 max-w-md mx-auto">
                <div className="w-10 h-10 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center border border-[var(--border)]">
                  <UserStoryIcon />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold text-[var(--text-primary)]">Esta síntesis no tiene historias de usuario</h3>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                    Fue generada antes del contrato con historias. Migrala derivando historias de sus requerimientos
                    funcionales y del contexto del negocio (1 llamada al motor de IA).
                  </p>
                </div>

                {migrate.phase === "error" && (
                  <div className="w-full p-3 rounded-md bg-[var(--red-soft)] border border-red-500/30 text-[11px] text-[var(--text-primary)] space-y-2 text-left">
                    <div className="flex items-start gap-2">
                      <AlertIcon />
                      <p className="leading-snug">{migrate.error}</p>
                    </div>
                    <button type="button" className="btn btn-ghost text-xs py-1 min-h-[32px]" onClick={runMigration}>
                      Reintentar
                    </button>
                  </div>
                )}

                {migrate.phase === "running" ? (
                  <div className="flex items-center gap-2.5 text-xs text-[var(--text-muted)]">
                    <div className="w-4 h-4 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
                    <span>Migrando historias… (puede tardar ~1 min)</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button type="button" className="btn btn-primary min-h-[38px] px-4 text-xs font-semibold" onClick={runMigration}>
                      Migrar historias (1 llamada)
                    </button>
                    <button type="button" className="btn btn-ghost min-h-[38px] px-3 text-xs" onClick={openAddStory}>
                      + Añadir manual
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Sin historias activas (o todas eliminadas): se puede añadir o restaurar. */
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-3 max-w-md mx-auto">
                <div className="w-10 h-10 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center border border-[var(--border)]">
                  <UserStoryIcon />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold text-[var(--text-primary)]">No hay historias activas</h3>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                    Añadí una historia manualmente o restaurá una de las eliminadas.
                  </p>
                </div>
                <button type="button" className="btn btn-primary min-h-[38px] px-4 text-xs font-semibold" onClick={openAddStory}>
                  + Añadir historia
                </button>
              </div>
            )
          ) : (
            <>
              <SearchHeader
                label="Buscar historias de usuario"
                count={`${filteredStories.length} historias de usuario`}
                placeholder="Buscar historia…"
                actions={
                  <button
                    type="button"
                    className="btn btn-primary min-h-[30px] px-3 text-xs font-semibold"
                    onClick={openAddStory}
                    disabled={storyActionBusy}
                  >
                    + Nueva historia
                  </button>
                }
              />
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
                {filteredStories.map((h) => {
                  const highlighted = h.id === highlightStoryId;
                  const rfCount = rfCountForStory(h.id);
                  return (
                    <div
                      key={h.id}
                      id={`story-${h.id}`}
                      className={`p-3.5 rounded-md border bg-[var(--bg)] space-y-2.5 flex flex-col justify-between text-xs transition-all ${
                        highlighted
                          ? "border-[var(--accent)] ring-2 ring-[var(--accent)] shadow-lg"
                          : "border-[var(--border)]"
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono text-[10.5px] font-semibold text-[var(--text-muted)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
                              {h.id}
                            </span>
                            <span className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full border bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--border)] shrink-0">
                              {rfCount} RF{rfCount === 1 ? "" : "s"}
                            </span>
                          </div>
                          <span className={`text-[9.5px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${priorityBadgeClass(h.prioridad)}`}>
                            {h.prioridad}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--text-primary)] leading-relaxed">
                          <span className="font-semibold">Como {h.rol},</span> quiero {h.quiero}, <span className="font-semibold">para</span> {h.para}.
                        </p>
                        <div className="space-y-0.5 pt-1 border-t border-[var(--border)]">
                          <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] block font-semibold">
                            CRITERIOS DE ACEPTACIÓN
                          </span>
                          <ul className="list-disc list-inside space-y-0.5 text-[11px] text-[var(--text-secondary)]">
                            {h.criterios_de_aceptacion.map((c, i) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {synthesis?.historias_backfilled && (
                            <span
                              className="text-[9px] font-semibold bg-[var(--amber-soft)] text-[var(--amber)] px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0"
                              title="Derivadas de los RFs en una migración legacy"
                            >
                              legacy
                            </span>
                          )}
                          <span className="truncate" title={`Origen: ${h.origen}`}>
                            Origen: {h.origen}
                          </span>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            className="hover:text-[var(--text-primary)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                            onClick={() => openEditStory(h)}
                            aria-label={`Editar historia ${h.id}`}
                            title="Editar historia"
                          >
                            <PencilIcon />
                          </button>
                          <button
                            type="button"
                            className="hover:text-[var(--text-primary)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                            onClick={() => copy(`HS-${h.id.replace(/^HS-/, "")}: Como ${h.rol}, quiero ${h.quiero}, para ${h.para}.\nCriterios: ${h.criterios_de_aceptacion.join("; ")}`, h.id)}
                            aria-label={`Copiar historia ${h.id}`}
                            title={`Copiar historia ${h.id}`}
                          >
                            {copiedId === h.id ? <CheckIcon /> : <CopyIcon />}
                          </button>
                          <button
                            type="button"
                            className="text-[var(--red)] hover:bg-[var(--red-soft)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                            onClick={() =>
                              setDeletingStory({ id: h.id, label: h.titulo !== "(sin titulo)" ? h.titulo : `${h.id} (${h.rol})`, rfCount })
                            }
                            aria-label={`Eliminar historia ${h.id}`}
                            title="Eliminar historia"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Bloque de historias eliminadas (recuperables) */}
          {deletedStories.length > 0 && (
            <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                onClick={() => setShowDeleted(!showDeleted)}
                aria-expanded={showDeleted}
              >
                <span>Eliminadas ({deletedStories.length}) — recuperables</span>
                <span className="text-[10px]">{showDeleted ? "▾" : "▸"}</span>
              </button>
              {showDeleted && (
                <div className="p-2.5 border-t border-[var(--border)] space-y-1.5">
                  {deletedStories.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-2 text-[11px] px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)]"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-[var(--text-muted)] shrink-0">{d.id}</span>
                          <span className="truncate text-[var(--text-primary)]">
                            {d.titulo !== "(sin titulo)" ? d.titulo : `Como ${d.rol}, quiero ${d.quiero}`}
                          </span>
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {d.rf_ids_origen.length} RF{d.rf_ids_origen.length === 1 ? "" : "s"} referenciaban · eliminada{" "}
                          {(() => {
                            try {
                              return new Date(d.eliminada_at).toLocaleDateString();
                            } catch {
                              return "";
                            }
                          })()}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          className="text-[var(--red)] hover:bg-[var(--red-soft)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                          onClick={() =>
                            setPurgeTarget({
                              kind: "story",
                              id: d.id,
                              label: d.titulo !== "(sin titulo)" ? d.titulo : `${d.id} (${d.rol})`,
                            })
                          }
                          disabled={storyActionBusy}
                          title="Eliminar definitivamente (sin recuperación)"
                          aria-label={`Eliminar definitivamente ${d.id}`}
                        >
                          <TrashIcon />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost text-[10.5px] py-1 px-2.5 border border-[var(--border)] flex items-center gap-1.5 shrink-0"
                          onClick={() => void restoreStory(d.id)}
                          disabled={storyActionBusy}
                        >
                          <RestoreIcon />
                          Restaurar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Overlay: confirmar eliminación de una historia de usuario (soft delete) */}
      {deletingStory && (
        <div className="fixed inset-0 z-[400] bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="p-3.5 rounded-md bg-[var(--surface)] border border-[var(--border)] max-w-xs w-full space-y-2.5 shadow-xl">
            <h3 className="text-xs font-semibold text-[var(--red)]">¿Eliminar esta historia?</h3>
            <p className="text-[11px] text-[var(--text-muted)] break-all">{deletingStory.label}</p>
            <p className="text-[11px] text-[var(--text-muted)]">
              {deletingStory.rfCount > 0
                ? `${deletingStory.rfCount} requerimiento(s) dejarán de referenciarla.`
                : "Ningún requerimiento la referencia."}{" "}
              Podés recuperarla después desde "Eliminadas".
            </p>
            <div className="flex justify-end gap-2 pt-0.5">
              <button type="button" className="btn btn-ghost text-xs py-1 min-h-[32px]" onClick={() => setDeletingStory(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary bg-[var(--red)] text-white hover:opacity-90 text-xs py-1 min-h-[32px]"
                disabled={storyActionBusy}
                onClick={() => void confirmDeleteStory()}
              >
                {storyActionBusy ? "Eliminando…" : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay: formulario de historia de usuario (añadir / editar) */}
      {storyForm.open &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-[var(--scrim)] p-4"
            onClick={() => {
              if (!storyForm.busy) setStoryForm((f) => ({ ...f, open: false }));
            }}
          >
            <div
              className="w-[500px] max-w-[92vw] max-h-[85vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                    {storyForm.mode === "add" ? "Nueva historia de usuario" : `Editar ${storyForm.storyId}`}
                  </h3>
                  {storyForm.mode === "edit" && (
                    <p className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
                      id y origen se preservan (trazabilidad)
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={storyForm.busy}
                  onClick={() => setStoryForm((f) => ({ ...f, open: false }))}
                  className="shrink-0 p-0.5 rounded text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                  aria-label="Cerrar"
                >
                  <CloseXIcon />
                </button>
              </div>

              {storyForm.error && (
                <div className="p-2.5 rounded-md bg-[var(--red-soft)] border border-red-500/30 text-[11px] text-[var(--text-primary)]">
                  {storyForm.error}
                </div>
              )}

              <div className="space-y-2">
                <label className="block space-y-0.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                    Título <span className="text-[var(--text-faint)]">(opcional)</span>
                  </span>
                  <input
                    type="text"
                    className="textarea-minimal text-xs py-1.5 w-full"
                    placeholder="Título corto, apto para un issue"
                    value={storyForm.titulo}
                    onChange={(e) => setStoryForm((f) => ({ ...f, titulo: e.target.value }))}
                    disabled={storyForm.busy}
                  />
                </label>

                <label className="block space-y-0.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                    Rol <span className="text-[var(--red)]">*</span>
                  </span>
                  <input
                    type="text"
                    className="textarea-minimal text-xs py-1.5 w-full"
                    placeholder="Ej: maestra, operador de chacra, admin…"
                    value={storyForm.rol}
                    onChange={(e) => setStoryForm((f) => ({ ...f, rol: e.target.value }))}
                    disabled={storyForm.busy}
                  />
                </label>

                <label className="block space-y-0.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                    Quiero <span className="text-[var(--red)]">*</span>
                  </span>
                  <input
                    type="text"
                    className="textarea-minimal text-xs py-1.5 w-full"
                    placeholder="La acción que el rol quiere poder realizar"
                    value={storyForm.quiero}
                    onChange={(e) => setStoryForm((f) => ({ ...f, quiero: e.target.value }))}
                    disabled={storyForm.busy}
                  />
                </label>

                <label className="block space-y-0.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                    Para <span className="text-[var(--red)]">*</span>
                  </span>
                  <textarea
                    rows={2}
                    className="textarea-minimal text-xs py-1.5 w-full"
                    placeholder="El beneficio o motivo por el que la quiere"
                    value={storyForm.para}
                    onChange={(e) => setStoryForm((f) => ({ ...f, para: e.target.value }))}
                    disabled={storyForm.busy}
                  />
                </label>

                <label className="block space-y-0.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                    Prioridad <span className="text-[var(--text-faint)]">(opcional)</span>
                  </span>
                  <select
                    className="textarea-minimal text-xs py-1.5 w-full"
                    value={storyForm.prioridad}
                    onChange={(e) => setStoryForm((f) => ({ ...f, prioridad: e.target.value }))}
                    disabled={storyForm.busy}
                  >
                    <option>Must have</option>
                    <option>Should have</option>
                    <option>Nice to have</option>
                  </select>
                </label>

                <div className="space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                    Criterios de aceptación <span className="text-[var(--text-faint)]">(opcional)</span>
                  </span>
                  <div className="space-y-1">
                    {storyForm.criterios.map((c, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input
                          type="text"
                          className="textarea-minimal text-xs py-1.5 flex-1"
                          placeholder="Criterio verificable"
                          value={c}
                          onChange={(e) =>
                            setStoryForm((f) => {
                              const next = [...f.criterios];
                              next[i] = e.target.value;
                              return { ...f, criterios: next };
                            })
                          }
                          disabled={storyForm.busy}
                        />
                        <button
                          type="button"
                          className="icon-btn text-[var(--red)] w-5 h-5 p-0 hover:bg-[var(--red-soft)] rounded shrink-0"
                          onClick={() => setStoryForm((f) => ({ ...f, criterios: f.criterios.filter((_, j) => j !== i) }))}
                          disabled={storyForm.busy}
                          title="Quitar criterio"
                        >
                          <CloseXIcon />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn-ghost text-[10.5px] py-1 px-2.5 border border-[var(--border)]"
                      onClick={() => setStoryForm((f) => ({ ...f, criterios: [...f.criterios, ""] }))}
                      disabled={storyForm.busy}
                    >
                      + Agregar criterio
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  className="btn btn-ghost text-xs py-1 min-h-[32px]"
                  onClick={() => setStoryForm((f) => ({ ...f, open: false }))}
                  disabled={storyForm.busy}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-primary text-xs py-1 min-h-[32px] font-semibold"
                  onClick={() => void submitStoryForm()}
                  disabled={storyForm.busy}
                >
                  {storyForm.busy ? "Guardando…" : storyForm.mode === "add" ? "Añadir historia" : "Guardar cambios"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
