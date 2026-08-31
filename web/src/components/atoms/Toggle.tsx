export function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-[background-color] duration-200 active:scale-[0.96] ${checked ? "bg-violet-600 hover:bg-violet-700" : "bg-gray-200 hover:bg-gray-300"}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-[transform] duration-200 ${checked ? "translate-x-5" : "translate-x-0"}`}
        style={{ boxShadow: "0 1px 4px oklch(0 0 0 / 0.18)" }}
      />
    </button>
  );
}
