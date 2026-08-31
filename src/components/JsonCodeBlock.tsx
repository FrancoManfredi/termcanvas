// JSON coloreado para los desplegables de entrevistas (diseño v2 del figma).
// Sintaxis: keys en cyan, strings en verde, números en ámbar, booleanos en
// violeta, null en rojo. Escapa HTML para prevenir XSS (el JSON viene de
// disco/modelo).

interface JsonCodeBlockProps {
  data: unknown;
  maxHeight?: string;
}

export function JsonCodeBlock({ data, maxHeight = "320px" }: JsonCodeBlockProps) {
  const json = JSON.stringify(data, null, 2);

  // Escapa caracteres especiales HTML para prevenir XSS.
  const escapeHtml = (str: string) =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const escapedJson = escapeHtml(json);

  // Syntax highlighting: strings (con su ":" si son keys), booleanos,
  // null y números.
  const highlightedHtml = escapedJson.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = "text-amber-600 dark:text-amber-400"; // number
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = "text-cyan-600 dark:text-cyan-400 font-semibold"; // key
        } else {
          cls = "text-emerald-600 dark:text-emerald-400"; // string
        }
      } else if (/true|false/.test(match)) {
        cls = "text-purple-600 dark:text-purple-400 font-semibold"; // boolean
      } else if (/null/.test(match)) {
        cls = "text-rose-600 dark:text-rose-400 font-semibold"; // null
      }
      return `<span class="${cls}">${match}</span>`;
    },
  );

  return (
    <pre
      style={{ maxHeight }}
      className="p-3 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[11px] font-mono text-[var(--text-primary)] overflow-x-auto overflow-y-auto whitespace-pre leading-relaxed select-all shadow-inner"
    >
      <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
    </pre>
  );
}
