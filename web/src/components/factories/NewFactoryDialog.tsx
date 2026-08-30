// NewFactoryDialog — SRP: alta de factory en un campo + disclosure de alias/repos/policy.
// DIP: las reglas vienen del dominio (factory.record / factory.policy); el store llega por hook.
// UX: Nielsen (un solo campo obligatorio, errores en vivo, estado visible) + Fitts (primaria grande a la izquierda).
// Source: WarpFactories.md §2, §10 Settings Identity, §14 Sizing · US-001, US-002, US-005

import { useState } from "react";
import type { FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import {
  FACTORY_NAME_MAX,
  defaultAliasFor,
  validateFactoryCreate,
} from "../../lib/factory/domain/factory.record";
import type { CreateFactoryInput, FactoryRecord } from "../../lib/factory/domain/factory.record";
import { DEFAULT_POLICY } from "../../lib/factory/domain/factory.policy";
import type { RepositoryRef } from "../../lib/factory/domain/types";
import { useFactoryWorkspace } from "../../lib/factory/hooks/useFactories";

const EASE_ARRAY = [0.2, 0, 0, 1] as const;

/** Presets de un clic: cero tecleo en el happy path (Diseño §5.3 punto 3). */
const SEED_REPOS: readonly RepositoryRef[] = [
  { owner: "acme", name: "payments-service" },
  { owner: "acme", name: "payments-api" },
];

export interface NewFactoryDialogProps {
  /** Nombre precargado cuando el alta nace del atajo "Crear factory separada" (US-005). */
  suggestedName?: string;
  onClose: () => void;
  onCreated?: (record: FactoryRecord) => void;
}

/** Error de submit. `suggestedName` habilita el atajo "Crear factory separada" (US-005). */
interface DialogConflict {
  readonly message: string;
  readonly suggestedName: string | null;
}

export function NewFactoryDialog({
  suggestedName,
  onClose,
  onCreated,
}: NewFactoryDialogProps) {
  const { factories, create } = useFactoryWorkspace();

  const [name, setName] = useState(suggestedName ?? "");
  // `null` = el alias se auto-copia del nombre (US-001); el usuario nunca lo ve por defecto.
  const [aliasDraft, setAliasDraft] = useState<string | null>(null);
  const [aliasOpen, setAliasOpen] = useState(false);
  const [repos, setRepos] = useState<readonly RepositoryRef[]>(SEED_REPOS);
  const [conflict, setConflict] = useState<DialogConflict | null>(null);

  const input: CreateFactoryInput = {
    name,
    ...(aliasDraft === null ? {} : { alias: aliasDraft }),
    repositories: repos,
  };

  // Validación en vivo en cada keystroke: el dominio es puro y barato, no hace falta memo.
  const validation = validateFactoryCreate(input, { existing: factories });
  const nameError = validation.issues.find((issue) => issue.path === "name")?.message;
  const aliasError = validation.issues.find((issue) => issue.path === "alias")?.message;
  const aliasPreview = aliasDraft ?? defaultAliasFor(name.trim());
  const canSubmit = name.trim() !== "" && nameError === undefined && aliasError === undefined;

  function isRepoOn(repo: RepositoryRef): boolean {
    return repos.some((r) => r.owner === repo.owner && r.name === repo.name);
  }

  function toggleRepo(repo: RepositoryRef): void {
    setRepos((prev) =>
      prev.some((r) => r.owner === repo.owner && r.name === repo.name)
        ? prev.filter((r) => !(r.owner === repo.owner && r.name === repo.name))
        : [...prev, repo]
    );
  }

  /** Atajo de US-005: reabre el alta con el nombre de la factory separada sugerida. */
  function handleCreateSeparate(): void {
    if (conflict?.suggestedName === null || conflict?.suggestedName === undefined) return;
    setName(conflict.suggestedName);
    setAliasDraft(null);
    setConflict(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit) return;

    const created = create(input);
    if (!created.ok || created.value === undefined) {
      setConflict({
        message: created.issues.map((issue) => issue.message).join(" · "),
        suggestedName: null,
      });
      return;
    }
    const record = created.value;
    onCreated?.(record);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-zinc-900/20 p-4"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-factory-title"
        initial={{ opacity: 0, y: 8, scale: 0.98, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        transition={{ duration: 0.22, ease: EASE_ARRAY }}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[480px] rounded-[12px] border border-zinc-200 bg-white p-4 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2
              id="new-factory-title"
              className="text-[15px] font-[650] tracking-[-0.02em] text-zinc-900"
            >
              Nueva factory
            </h2>
            <p className="mt-0.5 text-[11.5px] leading-snug text-zinc-500">
              Un solo dato obligatorio: el nombre. El resto tiene defaults sensibles
              (WarpFactories.md §2, §10 · US-001).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-zinc-400 transition-[background-color,color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-zinc-900/[0.06] hover:text-zinc-700 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-3">
          {/* Campo único — Fitts: input ancho, foco automático, Enter crea. */}
          <label htmlFor="factory-name" className="block text-[12px] font-medium text-zinc-700">
            Nombre de la factory <span className="text-red-500">*</span>
          </label>
          <input
            id="factory-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={FACTORY_NAME_MAX}
            placeholder="payments-factory"
            aria-invalid={nameError !== undefined}
            aria-describedby={nameError !== undefined ? "factory-name-error" : undefined}
            className={[
              "mt-1.5 h-9 w-full rounded-[8px] border bg-white px-2.5 text-[13px] text-zinc-900 outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-zinc-400 focus:ring-2 focus:ring-violet-500/20",
              nameError !== undefined ? "border-red-300" : "border-zinc-200 focus:border-violet-400",
            ].join(" ")}
          />
          {nameError !== undefined && (
            <p id="factory-name-error" className="mt-1 text-[11.5px] text-red-600">
              {nameError}
            </p>
          )}

          {/* Progressive disclosure — el alias se auto-copia del nombre y solo se edita si el usuario lo pide. */}
          <div className="mt-2.5 rounded-[8px] border border-zinc-200 bg-subsurface px-2.5 py-2">
            {aliasOpen ? (
              <div>
                <label htmlFor="factory-alias" className="block text-[11.5px] font-medium text-zinc-700">
                  Foreman name (alias)
                </label>
                <input
                  id="factory-alias"
                  autoFocus
                  value={aliasDraft ?? ""}
                  onChange={(event) => setAliasDraft(event.target.value)}
                  placeholder={aliasPreview}
                  aria-invalid={aliasError !== undefined}
                  className={[
                    "mt-1 h-8 w-full rounded-[8px] border bg-white px-2 text-[12.5px] text-zinc-900 outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-zinc-400 focus:ring-2 focus:ring-violet-500/20",
                    aliasError !== undefined ? "border-red-300" : "border-zinc-200 focus:border-violet-400",
                  ].join(" ")}
                />
              </div>
            ) : (
              <p className="text-[12px] text-zinc-600">
                Foreman name:{" "}
                <span className="font-mono text-[12px] text-zinc-800">
                  {aliasPreview === "" ? "(se copia del nombre)" : aliasPreview}
                </span>{" "}
                <button
                  type="button"
                  onClick={() => setAliasOpen(true)}
                  className="ml-0.5 text-[12px] font-medium text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
                >
                  Editar
                </button>
              </p>
            )}
            {aliasError !== undefined && (
              <p className="mt-1 text-[11.5px] text-red-600">{aliasError}</p>
            )}
          </div>

          {/* Repos — presets pre-marcados: cero tecleo en el happy path. */}
          <div className="mt-2.5">
            <span className="block text-[11.5px] font-medium text-zinc-700">Repositorios</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {SEED_REPOS.map((repo) => {
                const on = isRepoOn(repo);
                return (
                  <button
                    key={`${repo.owner}/${repo.name}`}
                    type="button"
                    onClick={() => toggleRepo(repo)}
                    aria-pressed={on}
                    className={[
                      "rounded-full border px-2.5 py-1 font-mono text-[11.5px] transition-[background-color,border-color,color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20",
                      on
                        ? "border-violet-200 bg-violet-50 text-violet-800"
                        : "border-zinc-200 bg-white text-zinc-500 hover:text-zinc-700",
                    ].join(" ")}
                  >
                    {on ? "✓ " : ""}
                    {repo.owner}/{repo.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Policy — una factory nace con una única policy y no permite combinar políticas (US-005). */}
          <div className="mt-2.5 rounded-[8px] border border-zinc-200 bg-subsurface px-2.5 py-2">
            <span className="block text-[11.5px] font-medium text-zinc-700">Policy única</span>
            <p className="mt-1 text-[11.5px] leading-snug text-zinc-500">
              {DEFAULT_POLICY.label}. Para otra policy, creá una factory separada (WarpFactories.md §2, §14 · US-005).
            </p>
          </div>

          <AnimatePresence initial={false}>
            {conflict !== null && (
              <motion.div
                key="conflict"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: EASE_ARRAY }}
                className="overflow-hidden"
              >
                <div className="mt-3 flex items-start gap-2 rounded-[8px] border border-amber-200 bg-amber-50 p-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" strokeWidth={1.8} />
                  <div className="min-w-0">
                    <p className="text-[12px] leading-snug text-amber-900">{conflict.message}</p>
                    {conflict.suggestedName !== null && (
                      <button
                        type="button"
                        onClick={handleCreateSeparate}
                        className="mt-1.5 rounded-[8px] bg-amber-900 px-2.5 py-1 text-[11.5px] font-medium text-white transition-[background-color,scale] duration-150 hover:bg-amber-800 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
                      >
                        Crear factory separada
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Acciones — primaria grande a la izquierda (Fitts); la secundaria explica por qué está deshabilitada. */}
          <div className="mt-3.5 flex items-center gap-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-[8px] bg-zinc-900 px-3.5 py-2 text-[13px] font-medium text-white transition-[background-color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-zinc-800 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Crear factory
            </button>
            <span title="disponible en T-E" className="inline-flex">
              <button
                type="button"
                disabled
                aria-describedby="wizard-hint"
                className="cursor-not-allowed rounded-[8px] px-3 py-2 text-[13px] font-[450] text-zinc-400"
              >
                Usar el wizard de 7 pasos →
              </button>
            </span>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded-[8px] px-2.5 py-2 text-[13px] font-[450] text-zinc-500 transition-[color] duration-150 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
            >
              Cancelar
            </button>
          </div>
          <p id="wizard-hint" className="mt-1 text-[11px] text-zinc-400">
            El wizard de 7 pasos (G4, US-142/143/144) se implementa en T-E.
          </p>
        </form>
      </motion.div>
    </div>
  );
}
