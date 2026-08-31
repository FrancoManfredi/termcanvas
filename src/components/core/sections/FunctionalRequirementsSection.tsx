// Sección POST ENTREVISTAS → Requerimientos Funcionales.
//
// Formalización N:N de las historias (un RF puede formalizar varias vía
// historias_origen). Extraída VERBATIM del cuerpo de CoreArchitectureModal;
// el estado cruzado llega por CoreModalContext y la curaduría es local.

import { useCoreModal } from "../context";
import { useCurationForm } from "../forms";
import { useCurationMutations, usePurge } from "../mutations";
import { CurationFormPortal } from "../CurationFormPortal";
import { NoSynthesis, SearchHeader, SynthLoading } from "../sectionChrome";
import {
  CheckIcon,
  CopyIcon,
  DeletedBlock,
  DeletedRow,
  PencilIcon,
  TrashIcon,
  curationItemLabel,
  priorityBadgeClass,
} from "../shared";

export function FunctionalRequirementsSection() {
  const {
    synthesis,
    synthesisPath,
    synthLoading,
    applySynthesis,
    search,
    copiedId,
    copy,
    jumpToStory,
    curDeletedOpen,
    setCurDeletedOpen,
  } = useCoreModal();

  const { curForm, setCurForm, openCurationAdd, openCurationEdit, setCurValue, submitCurationForm, closeCurationForm } =
    useCurationForm(synthesisPath, applySynthesis);
  const { deletingCuration, setDeletingCuration, curActionBusy, confirmDeleteCuration, restoreCuration } =
    useCurationMutations({ synthesisPath, applySynthesis });
  const { setPurgeTarget } = usePurge({ synthesisPath, applySynthesis });

  const hasSynthesis = synthesis !== null;
  const requirements = synthesis?.requerimientos_funcionales ?? [];
  const filteredRequirements = requirements.filter(
    (r) =>
      r.descripcion.toLowerCase().includes(search.toLowerCase()) ||
      r.justificacion.toLowerCase().includes(search.toLowerCase()) ||
      r.id.toLowerCase().includes(search.toLowerCase()) ||
      r.origen.toLowerCase().includes(search.toLowerCase()) ||
      (r.historias_origen ?? []).join(" ").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      {synthLoading ? (
        <SynthLoading />
      ) : !hasSynthesis ? (
        <NoSynthesis />
      ) : (
        <div className="space-y-4">
          <SearchHeader
            label="Buscar requerimientos funcionales"
            count={`${filteredRequirements.length} requerimientos funcionales`}
            placeholder="Buscar requerimiento…"
            actions={
              <button
                type="button"
                className="btn btn-primary min-h-[30px] px-3 text-xs font-semibold"
                onClick={() => openCurationAdd("rf")}
                disabled={curActionBusy}
              >
                + Nuevo
              </button>
            }
          />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {filteredRequirements.map((req) => (
              <div
                key={req.id}
                className="p-3.5 rounded-md border border-[var(--border)] bg-[var(--bg)] space-y-2.5 flex flex-col justify-between text-xs"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono text-[10.5px] font-semibold text-[var(--text-muted)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
                        {req.id}
                      </span>
                      {req.historia_origen !== undefined &&
                        req.historias_origen !== undefined &&
                        (req.historias_origen ?? []).length > 0 && (
                          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                            {(req.historias_origen ?? []).map((hsId) => (
                              <button
                                key={hsId}
                                type="button"
                                className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full border bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--border)] hover:border-[var(--accent)] transition-colors cursor-pointer"
                                onClick={() => jumpToStory(hsId)}
                                title={`Formaliza la historia ${hsId}`}
                              >
                                ← {hsId}
                              </button>
                            ))}
                          </div>
                        )}
                    </div>
                    <span className={`text-[9.5px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${priorityBadgeClass(req.prioridad)}`}>
                      {req.prioridad}
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-[var(--text-primary)] leading-snug">{req.descripcion}</p>
                  <div className="space-y-0.5 pt-1 border-t border-[var(--border)]">
                    <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] block font-semibold">
                      JUSTIFICACIÓN
                    </span>
                    <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{req.justificacion}</p>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] block font-semibold">
                      CRITERIO DE AJUSTE
                    </span>
                    <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{req.criterio_de_ajuste}</p>
                  </div>
                </div>
                <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
                  <span className="truncate max-w-[200px]" title={`Origen: ${req.origen}`}>
                    Origen: {req.origen}
                  </span>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      className="hover:text-[var(--text-primary)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                      onClick={() => openCurationEdit("rf", req.id, req)}
                      aria-label={`Editar requerimiento ${req.id}`}
                      title="Editar requerimiento"
                    >
                      <PencilIcon />
                    </button>
                    <button
                      type="button"
                      className="hover:text-[var(--text-primary)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                      onClick={() => copy(`${req.id}: ${req.descripcion}\nJustificación: ${req.justificacion}`, req.id)}
                      aria-label={`Copiar requerimiento ${req.id}`}
                      title={`Copiar requerimiento ${req.id}`}
                    >
                      {copiedId === req.id ? <CheckIcon /> : <CopyIcon />}
                    </button>
                    <button
                      type="button"
                      className="text-[var(--red)] hover:bg-[var(--red-soft)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                      onClick={() => setDeletingCuration({ kind: "rf", id: req.id, label: curationItemLabel("rf", req) })}
                      aria-label={`Eliminar requerimiento ${req.id}`}
                      title="Eliminar requerimiento"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <DeletedBlock
            count={synthesis?.rfs_eliminados?.length ?? 0}
            open={curDeletedOpen}
            onToggle={() => setCurDeletedOpen(!curDeletedOpen)}
          >
            {(synthesis?.rfs_eliminados ?? []).map((d) => (
              <DeletedRow
                key={d.id}
                idLabel={d.id}
                title={d.descripcion !== "(sin descripcion)" ? d.descripcion : d.id}
                meta={d.eliminada_at ? `eliminado ${new Date(d.eliminada_at).toLocaleDateString()}` : ""}
                onRestore={() => void restoreCuration("rf", d.id)}
                onPurge={() => setPurgeTarget({ kind: "rf", id: d.id, label: d.descripcion })}
                disabled={curActionBusy}
              />
            ))}
          </DeletedBlock>
        </div>
      )}

      {/* Overlay: confirmar eliminación de un ítem (RF/ASR/restricción/término) */}
      {deletingCuration && (
        <div className="fixed inset-0 z-[400] bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="p-3.5 rounded-md bg-[var(--surface)] border border-[var(--border)] max-w-xs w-full space-y-2.5 shadow-xl">
            <h3 className="text-xs font-semibold text-[var(--red)]">¿Eliminar este ítem?</h3>
            <p className="text-[11px] text-[var(--text-muted)] break-words">{deletingCuration.label}</p>
            <p className="text-[11px] text-[var(--text-muted)]">Se mueve a eliminados y podés recuperarlo después.</p>
            <div className="flex justify-end gap-2 pt-0.5">
              <button type="button" className="btn btn-ghost text-xs py-1 min-h-[32px]" onClick={() => setDeletingCuration(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary bg-[var(--red)] text-white hover:opacity-90 text-xs py-1 min-h-[32px]"
                disabled={curActionBusy}
                onClick={() => void confirmDeleteCuration()}
              >
                {curActionBusy ? "Eliminando…" : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay: formulario genérico de curaduría */}
      {curForm.open && (
        <CurationFormPortal
          curForm={curForm}
          setCurForm={setCurForm}
          setValue={setCurValue}
          submit={submitCurationForm}
          close={closeCurationForm}
        />
      )}
    </>
  );
}
