export interface DevEmptyProps {
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}

/**
 * The single empty state. Every screen used to invent its own centred
 * sentence, so "you have none of these" and "the fetch failed" looked
 * identical — see `DevError` for the other half of that distinction.
 */
export const DevEmpty = (props: DevEmptyProps) => (
  <div className="dt-empty">
    <span className="dt-empty-title">{props.title}</span>
    {props.hint && <span className="dt-empty-hint">{props.hint}</span>}
    {props.action && (
      <button type="button" className="dt-btn" onClick={props.action.onClick}>
        {props.action.label}
      </button>
    )}
  </div>
);
