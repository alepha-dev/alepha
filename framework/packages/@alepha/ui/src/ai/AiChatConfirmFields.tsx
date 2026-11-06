export interface AiChatConfirmFieldsProps {
  input: Record<string, unknown>;
}

/**
 * A call's input as label and value rows: the `params`, `query` and `body`
 * parts flattened into one list, a nested object written as `a.b`.
 */
export const AiChatConfirmFields = (props: AiChatConfirmFieldsProps) => {
  const rows = flattenInput(props.input);
  if (rows.length === 0) {
    return null;
  }
  return (
    <dl
      data-testid="ai-chat-confirm-fields"
      className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"
    >
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
};

const PARTS = new Set(["params", "query", "body"]);

/**
 * A value as one line: a scalar as written, anything else as JSON.
 */
const scalar = (value: unknown): string =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean"
    ? String(value)
    : JSON.stringify(value);

const flattenInput = (
  input: Record<string, unknown>,
  prefix = "",
): Array<[string, string]> => {
  const rows: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(input ?? {})) {
    // The action's input parts are plumbing, not fields the user reads.
    const label = !prefix && PARTS.has(key) ? "" : `${prefix}${key}`;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      rows.push(
        ...flattenInput(
          value as Record<string, unknown>,
          label ? `${label}.` : "",
        ),
      );
    } else if (value !== undefined) {
      rows.push([
        label || key,
        Array.isArray(value) ? value.map(scalar).join(", ") : scalar(value),
      ]);
    }
  }
  return rows;
};
