import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary] render error", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto bg-white p-6">
        <div className="w-full max-w-[520px] rounded-[12px] border border-red-200 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
          <h2 className="text-[14px] font-[600] tracking-[-0.01em] text-zinc-900">Something went wrong</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">The rest of the app is still available. Try reloading.</p>
          <pre className="mt-3 max-h-[180px] overflow-auto rounded-[8px] border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-red-700 whitespace-pre-wrap">
            {error.message || String(error)}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 h-9 w-full rounded-[8px] bg-zinc-900 px-4 text-[13px] font-medium text-white transition-[background-color,scale] duration-150 hover:bg-zinc-800 active:scale-[0.98]"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
