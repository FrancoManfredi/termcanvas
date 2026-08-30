// StepIdentity — SRP: Paso 3 — nombre factory custom 3-40 con validación inline y preview slug

import { slugifyUid } from "../../../lib/factory/domain/factory.record";

export interface StepIdentityProps {
  readonly name: string;
  readonly alias: string;
  readonly onName: (v: string) => void;
  readonly onAlias: (v: string) => void;
  readonly existingNames?: readonly string[];
}

export function StepIdentity({ name, alias, onName, onAlias }: StepIdentityProps) {
  const trimmed = name.trim();
  const previewSlug = slugifyUid(trimmed) || "factory";
  let nameError: string | null = null;
  if (trimmed.length > 0 && trimmed.length < 3) nameError = "Mínimo 3 caracteres";
  else if (trimmed.length > 40) nameError = "Máximo 40 caracteres";
  else if (trimmed && !/^[A-Za-z0-9 ._-]+$/.test(trimmed)) nameError = "solo [A-Za-z0-9 ._-]";

  return (
    <div className="grid gap-5">
      <label className="grid gap-2 text-sm font-medium text-zinc-700">
        Nombre de la factory
        <input
          className={`rounded-lg border px-3 py-2 font-normal focus:outline-none focus:ring-2 focus:ring-violet-500/20 ${nameError ? "border-red-300 focus:border-red-400" : "border-zinc-300 focus:border-violet-400"}`}
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="mi-factory"
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? "name-error" : "name-preview"}
        />
        {nameError ? (
          <span id="name-error" className="text-xs text-red-600" role="alert">{nameError}</span>
        ) : (
          <span id="name-preview" className="text-xs text-zinc-500">Slug: {previewSlug}</span>
        )}
        <span className="text-xs font-normal text-zinc-400">3-40 caracteres, sin duplicados</span>
      </label>
      <label className="grid gap-2 text-sm font-medium text-zinc-700">
        Alias del Foreman
        <input
          className="rounded-lg border border-zinc-300 px-3 py-2 font-normal focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          value={alias}
          onChange={(e) => onAlias(e.target.value)}
        />
        <span className="text-xs font-normal text-zinc-500">Se deriva del nombre hasta que lo edites.</span>
      </label>
    </div>
  );
}
