// FactoryListActions — SRP: Export/Import de workspace V2 con validación y quota handling.
// Source: WarpFactories.md §7 · PRD P0-05
import { useRef, useState } from "react";
import { getDefaultWorkspace } from "../../lib/factory/store/factoryWorkspace.store";

export function FactoryListActions() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleExport() {
    const store = getDefaultWorkspace();
    const json = store.exportJSON();
    // Download as file + clipboard
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `termcanvas-workspace-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      // fallback to clipboard
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(json).then(() => {
        setMessage("Exportado ✓ — JSON copiado al clipboard y descargado");
        setError(null);
        window.setTimeout(() => setMessage(null), 2500);
      });
    } else {
      setMessage("Exportado ✓ — descargado");
      setError(null);
      window.setTimeout(() => setMessage(null), 2500);
    }
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const store = getDefaultWorkspace();
      const result = store.importJSON(text);
      if (result.ok) {
        setMessage("Importado ✓ — workspace actualizado");
        setError(null);
        window.setTimeout(() => setMessage(null), 2500);
      } else {
        const first = result.issues[0];
        const detail = first ? `${first.path}: ${first.message} (${first.code})` : "import failed";
        if (first?.code === "quota_exceeded") {
          setError("Cuota excedida — import no aplicado. Liberá espacio y reintentá.");
        } else {
          setError(`Import falló: ${detail}`);
        }
        setMessage(null);
      }
      // reset input to allow re-import same file
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  }

  return (
    <div className="flex items-center gap-2">
      <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFileChange} />
      <button
        type="button"
        onClick={handleExport}
        className="rounded-[8px] border border-zinc-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-zinc-700 hover:bg-zinc-50"
        aria-label="Exportar workspace"
      >
        Export
      </button>
      <button
        type="button"
        onClick={handleImportClick}
        className="rounded-[8px] bg-zinc-900 px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-zinc-800"
        aria-label="Importar workspace"
      >
        Import
      </button>
      {message ? <span className="text-[11px] font-medium text-emerald-700">{message}</span> : null}
      {error ? <span className="text-[11px] font-medium text-red-600">{error}</span> : null}
    </div>
  );
}

export default FactoryListActions;
