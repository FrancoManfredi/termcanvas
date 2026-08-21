// Sección POST ENTREVISTAS → Atributos de Calidad (ASR).
//
// Extraída VERBATIM del cuerpo de CoreArchitectureModal; el estado cruzado
// llega por CoreModalContext y la curaduría (kind "asr") es local.

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
} from "../shared";

export function QualityAttributesSection() {
  const {
    synthesis,
    synthesisPath,
    synthLoading,
    applySynthesis,
    search,
    copiedId,
    copy,
    curDeletedOpen,
    setCurDeletedOpen,
  } = useCoreModal();

  const { curForm, setCurForm, openCurationAdd, openCurationEdit, setCurValue, submitCurationForm, closeCurationForm } =
    useCurationForm(synthesisPath, applySynthesis);
  const { deletingCuration, setDeletingCuration, curActionBusy, confirmDeleteCuration, restoreCuration } =
    useCurationMutations({ synthesisPath, applySynthesis });
  const { setPurgeTarget } = usePurge({ synthesisPath, applySynthesis });

  const hasSynthesis = synthesis !== null;
  const qualityAttributes = synthesis?.atributos_de_calidad_y_asrs ?? [];
  const filteredQuality = qualityAttributes.filter(
    (q) =>
      q.atributo.toLowerCase().includes(search.toLowerCase()) ||
      q.justificacion_arquitectonica.toLowerCase().includes(search.toLowerCase()) ||
      q.id.toLowerCase().includes(search.toLowerCase()),
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
            label="Buscar atributos de calidad"
            count={`${filteredQuality.length} atributos ASR`}
            placeholder="Buscar atributo de calidad…"
            actions={
              <button
                type="button"
                className="btn btn-primary min-h-[30px] px-3 text-xs font-semibold"
                onClick={() => openCurationAdd("asr")}
                disabled={curActionBusy}
              >
                + Nuevo
              </button>
            }
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {filteredQuality.map((q) => (
              <div key={q.id} className="p-3.5 rounded-md border border-[var(--border)] bg-[var(--bg)] space-y-2.5 text-xs">
                <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10.5px] font-semibold text-[var(--text-primary)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
                      {q.id}
                    </span>
                    <span
                      className={`text-[9.5px] font-semibold px-2 py-0.5 rounded ${
                        q.es_asr_genuino
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                          : "bg-[var(--accent-soft)] text-[var(--accent)]"
                      }`}
                    >
                      {q.es_asr_genuino ? "ASR Genuino" : "Preferencia UX / Calidad"}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      className="hover:text-[var(--text-primary)] text-[var(--text-muted)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                      onClick={() => openCurationEdit("asr", q.id, q)}
                      aria-label={`Editar ASR ${q.id}`}
                      title="Editar ASR"
                    >
                      <PencilIcon />
                    </button>
                    <button
                      type="button"
                      className="hover:text-[var(--text-primary)] text-[var(--text-muted)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                      onClick={() => copy(`${q.id}: ${q.atributo}\n${q.justificacion_arquitectonica}`, q.id)}
                      aria-label={`Copiar atributo de calidad ${q.id}`}
                      title={`Copiar ASR ${q.id}`}
                    >
                      {copiedId === q.id ? <CheckIcon /> : <CopyIcon />}
                    </button>
                    <button
                      type="button"
                      className="text-[var(--red)] hover:bg-[var(--red-soft)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                      onClick={() => setDeletingCuration({ kind: "asr", id: q.id, label: curationItemLabel("asr", q) })}
                      aria-label={`Eliminar ASR ${q.id}`}
                      title="Eliminar ASR"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>

                <h3 className="text-xs font-bold text-[var(--text-primary)]">{q.atributo}</h3>

                <div className="space-y-0.5">
                  <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] block font-semibold">
                    JUSTIFICACIÓN ARQUITECTÓNICA
                  </span>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{q.justificacion_arquitectonica}</p>
                </div>

                <div className="p-2.5 rounded bg-[var(--surface)] border border-[var(--border)] space-y-1.5 text-[10.5px]">
                  <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] block font-semibold">
                    ESCENARIO TÉCNICO (6 PARTES)
                  </span>
                  <div className="grid grid-cols-2 gap-2 text-[10.5px]">
                    <div>
                      <span className="text-[var(--text-muted)] block">Fuente:</span>
                      <span className="text-[var(--text-primary)] font-medium">{q.escenario_tecnico_6_partes.fuente}</span>
                    </div>
                    <div>
                      <span className="text-[var(--text-muted)] block">Estímulo:</span>
                      <span className="text-[var(--text-primary)] font-medium">{q.escenario_tecnico_6_partes.estimulo}</span>
                    </div>
                    <div>
                      <span className="text-[var(--text-muted)] block">Artefacto:</span>
                      <span className="text-[var(--text-primary)] font-medium">{q.escenario_tecnico_6_partes.artefacto}</span>
                    </div>
                    <div>
                      <span className="text-[var(--text-muted)] block">Entorno:</span>
                      <span className="text-[var(--text-primary)] font-medium">{q.escenario_tecnico_6_partes.entorno}</span>
                    </div>
                    <div>
                      <span className="text-[var(--text-muted)] block">Respuesta:</span>
                      <span className="text-[var(--text-primary)] font-medium">{q.escenario_tecnico_6_partes.respuesta}</span>
                    </div>
                    <div>
                      <span className="text-[var(--text-muted)] block">Medida de respuesta:</span>
                      <span className="text-[var(--accent)] font-mono font-semibold">{q.escenario_tecnico_6_partes.medida_de_respuesta}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-0.5 pt-1 border-t border-[var(--border)]">
                  <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] block font-semibold">
                    TRADE-OFFS IDENTIFICADOS
                  </span>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{q.trade_offs_identificados}</p>
                  <span className="text-[10px] font-mono text-[var(--text-muted)] block pt-0.5">Origen: {q.origen}</span>
                </div>
              </div>
            ))}
          </div>
          <DeletedBlock
            count={synthesis?.asrs_eliminados?.length ?? 0}
            open={curDeletedOpen}
            onToggle={() => setCurDeletedOpen(!curDeletedOpen)}
          >
            {(synthesis?.asrs_eliminados ?? []).map((d) => (
              <DeletedRow
                key={d.id}
                idLabel={d.id}
                title={d.atributo !== "(sin atributo)" ? d.atributo : d.id}
                meta={d.eliminada_at ? `eliminado ${new Date(d.eliminada_at).toLocaleDateString()}` : ""}
                onRestore={() => void restoreCuration("asr", d.id)}
                onPurge={() => setPurgeTarget({ kind: "asr", id: d.id, label: d.atributo })}
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
