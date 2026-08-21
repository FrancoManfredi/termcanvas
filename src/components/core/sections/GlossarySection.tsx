// Sección POST ENTREVISTAS → Glosario del Proyecto.
//
// Extraída VERBATIM del cuerpo de CoreArchitectureModal; el estado cruzado
// llega por CoreModalContext y la curaduría (kind "term") es local.

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

export function GlossarySection() {
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
  const glossaryEntries = Object.entries(synthesis?.glosario_de_terminos ?? {});
  const filteredGlossary = glossaryEntries.filter(
    ([term, def]) =>
      term.toLowerCase().includes(search.toLowerCase()) ||
      def.toLowerCase().includes(search.toLowerCase()),
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
            label="Buscar términos en el glosario"
            count={`${filteredGlossary.length} términos registrados`}
            placeholder="Buscar término en el glosario…"
            actions={
              <button
                type="button"
                className="btn btn-primary min-h-[30px] px-3 text-xs font-semibold"
                onClick={() => openCurationAdd("term")}
                disabled={curActionBusy}
              >
                + Nuevo
              </button>
            }
          />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredGlossary.map(([term, definition], idx) => (
              <div key={idx} className="p-3 rounded-md border border-[var(--border)] bg-[var(--bg)] space-y-1 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-xs font-bold text-[var(--text-primary)] font-mono break-words">{term}</h3>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      className="hover:text-[var(--text-primary)] text-[var(--text-muted)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                      onClick={() => openCurationEdit("term", term, { termino: term, definicion: definition })}
                      aria-label={`Editar término ${term}`}
                      title="Editar término"
                    >
                      <PencilIcon />
                    </button>
                    <button
                      type="button"
                      className="text-[var(--red)] hover:bg-[var(--red-soft)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                      onClick={() => setDeletingCuration({ kind: "term", id: term, label: curationItemLabel("term", { termino: term, definicion: definition }) })}
                      aria-label={`Eliminar término ${term}`}
                      title="Eliminar término"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{definition}</p>
              </div>
            ))}
          </div>
          <DeletedBlock
            count={synthesis?.terminos_eliminados?.length ?? 0}
            open={curDeletedOpen}
            onToggle={() => setCurDeletedOpen(!curDeletedOpen)}
          >
            {(synthesis?.terminos_eliminados ?? []).map((d) => (
              <DeletedRow
                key={d.termino}
                idLabel={d.termino}
                title={d.definicion}
                meta={d.eliminada_at ? `eliminado ${new Date(d.eliminada_at).toLocaleDateString()}` : ""}
                onRestore={() => void restoreCuration("term", d.termino)}
                onPurge={() => setPurgeTarget({ kind: "term", id: d.termino, label: d.termino })}
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
