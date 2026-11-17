export interface AutomationCanvasValuesProps {
  values: Record<string, unknown>;
}

/**
 * A node's filters on the canvas, one `key: value` a line, each cut to the
 * card's width: the full value is in the node's panel.
 */
const AutomationCanvasValues = (props: AutomationCanvasValuesProps) => {
  const entries = Object.entries(props.values).filter(
    ([, value]) => value !== undefined && value !== "",
  );
  if (entries.length === 0) return null;
  return (
    <dl className="text-muted-foreground flex flex-col gap-0.5">
      {entries.map(([key, value]) => {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        return (
          <div key={key} className="flex min-w-0 gap-1" title={text}>
            <dt className="shrink-0">{key}:</dt>
            <dd className="truncate font-mono">{text}</dd>
          </div>
        );
      })}
    </dl>
  );
};

export default AutomationCanvasValues;
