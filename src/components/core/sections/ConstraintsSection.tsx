// Sección POST ENTREVISTAS → Restricciones Globales.
//
// Extraída VERBATIM del cuerpo de CoreArchitectureModal; el estado cruzado
// llega por CoreModalContext y la curaduría (kind "constraint") es local.

import { useCoreModal } from "../context";
import { useCurationForm } from "../forms";
import { useCurationMutations, usePurge } from "../mutations";
import { CurationFormPortal } from "../CurationFormPortal";
import { NoSynthesis, SearchHeader, SynthLoading } from "../sectionChrome";
import {
  DeletedBlock,
  DeletedRow,
  PencilIcon,
  TrashIcon,
  curationItemLabel,
} from "../shared";

export function ConstraintsSection() {
  const {
    synthesis,
    synthesisPath,
    synthLoading,
    applySynthesis,
    search,
    curDeletedOpen,
    setCurDeletedOpen,
  } = useCoreModal();

  const { curForm, setCurForm, openCurationAdd, openCurationEdit, setCurValue, submitCurationForm, closeCurationForm } =
    useCurationForm(synthesisPath, applySynthesis);
  const { deletingCuration, setDeletingCuration, curActionBusy, confirmDeleteCuration, restoreCuration } =
    useCurationMutations({ synthesisPath, applySynthesis });
  const { setPurgeTarget } = usePurge({ synthesisPath, applySynthesis });

  const hasSynthesis = synthesis !== null;
  const constraints = synthesis?.restricciones_globales ?? [];
  const filteredConstraints = constraints.filter(
    (c) =>
      c.tipo.toLowerCase().includes(search.toLowerCase()) ||
      c.descripcion.toLowerCase().includes(search.toLowerCase()) ||
      c.impacto.toLowerCase().includes(search.toLowerCase()) ||
      c.id.toLowerCase().includes(search.toLowerCase()),
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
            label="Buscar restricciones globales"
            count={`${filteredConstraints.length} restricciones globales`}
            placeholder="Buscar restricción…"
            actions={
              <button
                type="button"
                className="btn btn-primary min-h-[30px] px-3 text-xs font-semibold"
                onClick={() => openCurationAdd("constraint")}
                disabled={curActionBusy}
              >
                + Nuevo
              </button>
            }
          />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {filteredConstraints.map((c) => (
              <div
                key={c.id}
                className="p-3.5 rounded-md border border-[var(--border)] bg-[var(--bg)] space-y-2.5 flex flex-col justify-between text-xs"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-mono text-[10px] font-semibold text-[var(--amber)] bg-[var(--amber-soft)] px-2 py-0.5 rounded border border-amber-500/20 uppercase tracking-wider">
                      {c.tipo}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-mono text-[10.5px] font-semibold text-[var(--text-primary)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
                        {c.id}
                      </span>
                      <button
                        type="button"
                        className="hover:text-[var(--text-primary)] text-[var(--text-muted)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                        onClick={() => openCurationEdit("constraint", c.id, c)}
                        aria-label={`Editar restricción ${c.id}`}
                        title="Editar restricción"
                      >
                        <PencilIcon />
                      </button>
                      <button
                        type="button"
                        className="text-[var(--red)] hover:bg-[var(--red-soft)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                        onClick={() => setDeletingCuration({ kind: "constraint", id: c.id, label: curationItemLabel("constraint", c) })}
                        aria-label={`Eliminar restricción ${c.id}`}
                        title="Eliminar restricción"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs font-semibold text-[var(--text-primary)] leading-relaxed">{c.descripcion}</p>
                  <div className="p-2.5 rounded bg-[var(--red-soft)] border border-red-500/20 text-[11px] text-[var(--text-primary)] space-y-0.5">
                    <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--red)] font-semibold block">
                      ⚠ IMPACTO EN DISEÑO
                    </span>
                    <p className="leading-snug">{c.impacto}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <DeletedBlock
            count={synthesis?.restricciones_eliminadas?.length ?? 0}
            open={curDeletedOpen}
            onToggle={() => setCurDeletedOpen(!curDeletedOpen)}
          >
            {(synthesis?.restricciones_eliminadas ?? []).map((d) => (
              <DeletedRow
                key={d.id}
                idLabel={d.id}
                title={`${d.tipo}: ${d.descripcion}`}
                meta={d.eliminada_at ? `eliminado ${new Date(d.eliminada_at).toLocaleDateString()}` : ""}
                onRestore={() => void restoreCuration("constraint", d.id)}
                onPurge={() => setPurgeTarget({ kind: "constraint", id: d.id, label: `${d.tipo}: ${d.descripcion}` })}
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
