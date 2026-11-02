import type { ReactNode } from 'react';

/**
 * Unified loading / empty / error three-state component (UIUX P2 #8).
 *
 * Same contract as the model-hub / atlas AsyncState variants: exactly one of
 * loading / error / empty is shown, otherwise children render. This console
 * variant has zero icon dependencies — the spinner is a CSS ring and the
 * empty/error glyphs are inline SVG — so it works in any Astro island.
 * Styling consumes the @bayjf/console-ui token palette.
 */
export interface AsyncStateProps {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  loadingText?: string;
  emptyText?: string;
  errorText?: string;
  /** Shown under the error message; rendered as a primary button when provided. */
  onRetry?: () => void;
  children?: ReactNode;
}

function Spinner() {
  return (
    <span className="async-state__ring" aria-hidden="true" />
  );
}

function InboxGlyph() {
  return (
    <svg className="async-state__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

function AlertGlyph() {
  return (
    <svg className="async-state__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export default function AsyncState({
  loading,
  error,
  empty,
  loadingText = '加载中…',
  emptyText = '暂无数据',
  errorText = '加载失败',
  onRetry,
  children,
}: AsyncStateProps) {
  if (loading) {
    return (
      <div className="async-state" role="status">
        <Spinner />
        <span className="async-state__text">{loadingText}</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="async-state async-state--error" role="alert">
        <AlertGlyph />
        <div className="async-state__body">
          <span className="async-state__text">
            {errorText}：{error}
          </span>
          {onRetry && (
            <button className="btn btn--primary async-state__retry" onClick={onRetry}>
              重试
            </button>
          )}
        </div>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="async-state" role="status">
        <InboxGlyph />
        <span className="async-state__text">{emptyText}</span>
      </div>
    );
  }
  return children;
}
