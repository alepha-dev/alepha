import { useI18n } from "alepha/react/i18n";

export interface ApiKeyScopeSummaryProps {
  /**
   * The key's permission scope. Empty is everything its roles allow.
   */
  permissions: readonly string[];
}

/**
 * What a key may do, on its row: "Full access", or a count that opens to the
 * list. Without it a scope would be write-only, set in a dialog and never
 * seen again.
 */
export const ApiKeyScopeSummary = (props: ApiKeyScopeSummaryProps) => {
  const { tr } = useI18n();

  if (props.permissions.length === 0) {
    return (
      <span className="text-muted-foreground text-xs">
        {tr("account.keys.scopeFull", { default: "Full access" })}
      </span>
    );
  }

  return (
    <details className="text-xs">
      <summary className="text-muted-foreground cursor-pointer select-none">
        {tr("account.keys.scopeCount", {
          default: "$1 permission(s)",
          args: [String(props.permissions.length)],
        })}
      </summary>
      <ul className="mt-1 flex flex-col gap-0.5 font-mono">
        {props.permissions.map((permission) => (
          <li key={permission}>{permission}</li>
        ))}
      </ul>
    </details>
  );
};
