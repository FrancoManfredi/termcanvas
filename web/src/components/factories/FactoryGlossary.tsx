// FactoryGlossary — SRP: muestra la triada Warp Factories / factory / foreman (US-006).
// DIP: renderiza datos puros de `factory.policy`; no decide definiciones.
// Source: WarpFactories.md §1, §15 · US-006

import { FACTORY_GLOSSARY } from "../../lib/factory/domain/factory.policy";

export function FactoryGlossary() {
  return (
    <section
      aria-labelledby="factory-glossary-title"
      className="shrink-0 border-b border-zinc-200 bg-white"
    >
      <div className="mx-auto max-w-[1080px] px-4 py-3">
        <div className="flex items-center gap-2">
          <h2
            id="factory-glossary-title"
            className="text-[13px] font-[600] tracking-[-0.01em] text-zinc-900"
          >
            Glosario
          </h2>
          <span className="rounded-full bg-zinc-900/[0.05] px-1.5 py-0.5 text-[10.5px] font-medium text-zinc-500">
            WarpFactories.md §1, §15 + US-006
          </span>
        </div>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-zinc-500">
          Tres términos distintos que suelen confundirse. Nombrarlos bien evita sizear mal la factory
          (§14).
        </p>

        <dl className="mt-2.5 grid gap-2 sm:grid-cols-3">
          {FACTORY_GLOSSARY.map((entry) => (
            <div
              key={entry.term}
              className="rounded-[10px] border border-zinc-200 bg-subsurface p-2.5"
            >
              <dt className="text-[12.5px] font-[600] tracking-[-0.01em] text-zinc-900">
                {entry.term}
              </dt>
              <dd className="mt-1 text-[11.5px] leading-relaxed text-zinc-600">
                {entry.definition}
              </dd>
              <dd className="mt-1.5 font-mono text-[10px] text-zinc-400">{entry.trace}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
