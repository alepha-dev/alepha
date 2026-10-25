export interface DevErrorProps {
  what: string;
  message?: string;
  onRetry?: () => void;
}

/**
 * A failed fetch, rendered as a failure.
 *
 * Every fetch in devtools used to `catch {}` into an empty list, which is
 * indistinguishable from an application that genuinely declares none of the
 * thing you're looking at. That ambiguity is the bug this component exists to
 * remove.
 */
export const DevError = (props: DevErrorProps) => (
  <div className="dt-empty">
    <span className="dt-empty-title">Couldn’t load {props.what}</span>
    {props.message && (
      <span className="dt-empty-hint" style={{ color: "var(--dt-error)" }}>
        {props.message}
      </span>
    )}
    {props.onRetry && (
      <button type="button" className="dt-btn" onClick={props.onRetry}>
        Retry
      </button>
    )}
  </div>
);
