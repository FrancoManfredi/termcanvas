import type { ReactNode } from "react";

const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";
const BTN_PRIMARY = `px-4 py-1.5 bg-gray-900 text-white text-sm font-semibold rounded-md hover:bg-gray-700 ${BTN_PRESS}`;

export function BtnPrimary({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${BTN_PRIMARY} disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${className}`}>
      {children}
    </button>
  );
}

export { BTN_PRESS, BTN_PRIMARY };
