import type { ReactNode } from "react";

const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";
const BTN_SECONDARY = `px-4 py-1.5 border border-gray-200 text-gray-500 text-sm rounded-md hover:border-gray-300 hover:bg-gray-50 ${BTN_PRESS}`;

export function BtnSecondary({
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
    <button type="button" onClick={onClick} disabled={disabled} className={`${BTN_SECONDARY} disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${className}`}>
      {children}
    </button>
  );
}

export { BTN_PRESS, BTN_SECONDARY };
