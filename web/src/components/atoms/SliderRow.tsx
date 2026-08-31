export function SliderRow({
  label,
  required,
  subtitle,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  required?: boolean;
  subtitle: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-900 mb-0.5">
        {label} {required && <span className="text-red-400 font-normal">*</span>}
      </h3>
      <p className="text-xs text-gray-400 mb-4">{subtitle}</p>
      <div className="flex items-center gap-4">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="flex-1"
          style={{ background: `linear-gradient(to right, #111827 ${pct}%, #e5e7eb ${pct}%)` }}
        />
        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden" style={{ boxShadow: "0 1px 2px oklch(0 0 0 / 0.04)" }}>
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={step < 1 ? value.toFixed(2) : value}
            onChange={(e) => onChange(Math.min(max, Math.max(min, parseFloat(e.target.value) || min)))}
            className="w-14 px-2 py-2 text-sm text-right outline-none tabular-nums"
          />
          {suffix && <span className="pr-3 text-sm text-gray-400">{suffix}</span>}
        </div>
      </div>
    </section>
  );
}
