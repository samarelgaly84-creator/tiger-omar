import React from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';
import { reportClientError } from '../lib/api';

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode; onReset?: () => void }, State> {
  constructor(props: { children: React.ReactNode; onReset?: () => void }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message || 'Unexpected UI error' };
  }

  componentDidCatch(error: Error) {
    reportClientError(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[360px] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-xl bg-orange-500/15 text-orange-500 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">حدث خطأ غير متوقع / Unexpected Error</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 break-words">{this.state.errorMessage}</p>
            <button
              onClick={() => {
                this.setState({ hasError: false, errorMessage: '' });
                this.props.onReset?.();
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              إعادة التحميل / Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const NotFoundView: React.FC<{ onGoHome: () => void; title: string; desc: string; homeLabel: string }> = ({
  onGoHome,
  title,
  desc,
  homeLabel,
}) => (
  <div className="min-h-[60vh] flex items-center justify-center p-6">
    <div className="max-w-md w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center space-y-4">
      <div className="text-5xl font-display font-extrabold text-orange-500 tabular-nums">404</div>
      <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{title}</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{desc}</p>
      <button
        onClick={onGoHome}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors"
      >
        <Home className="w-4 h-4" />
        {homeLabel}
      </button>
    </div>
  </div>
);

export const LoadingSkeleton: React.FC<{ rows?: number }> = ({ rows = 3 }) => (
  <div className="space-y-4 animate-pulse">
    {Array.from({ length: rows }).map((_, i) => (
      <div
        key={i}
        className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800" />
          <div className="space-y-1.5 flex-1">
            <div className="h-3.5 w-36 rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-2.5 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </div>
        <div className="h-4 w-full rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-4 w-3/4 rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>
    ))}
  </div>
);
