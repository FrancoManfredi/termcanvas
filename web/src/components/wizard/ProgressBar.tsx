export function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex gap-1.5 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className={`h-1.5 rounded-full flex-1 transition-[background-color] duration-300 ${i < step ? "bg-violet-600" : "bg-gray-200"}`} />
      ))}
    </div>
  );
}
