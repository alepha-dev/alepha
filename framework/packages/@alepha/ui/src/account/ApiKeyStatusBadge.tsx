import type { ListApiKeyItem } from "alepha/api/keys";
import { useI18n } from "alepha/react/i18n";

import { Badge } from "../core/Badge.tsx";
import TimeAgo from "../core/TimeAgo.tsx";

export interface ApiKeyStatusBadgeProps {
  apiKey: Pick<ListApiKeyItem, "status" | "expiresAt" | "revokedAt">;

  /**
   * Show the status alone, without the moment that decides it. For a table
   * that already has an Expires column beside it, where "Expires in 3 days"
   * would say the same thing twice. Defaults to `false`.
   */
  labelOnly?: boolean;
}

/**
 * Where a key is in its life, with the moment that decides it: "Expires in
 * 3 days", "Expired 12 days ago", "Revoked a month ago", or for a healthy key
 * a quiet "Expires in 4 months" or "No expiry".
 *
 * One component for the account panel and the admin table, reading the
 * `status` the server derived, so the two surfaces cannot disagree about the
 * key an hour from its warning window.
 */
export const ApiKeyStatusBadge = (props: ApiKeyStatusBadgeProps) => {
  const { tr } = useI18n();
  const key = props.apiKey;
  const withTime = !props.labelOnly;

  if (key.status === "revoked") {
    return (
      <Badge variant="tint" tone="neutral">
        {tr("account.keys.status.revoked", { default: "Revoked" })}
        {withTime && key.revokedAt ? <TimeAgo value={key.revokedAt} /> : null}
      </Badge>
    );
  }

  if (key.status === "expired") {
    return (
      <Badge variant="tint" tone="danger">
        {tr("account.keys.status.expired", { default: "Expired" })}
        {withTime && key.expiresAt ? <TimeAgo value={key.expiresAt} /> : null}
      </Badge>
    );
  }

  if (key.status === "expiring") {
    return (
      <Badge variant="tint" tone="warning">
        {withTime
          ? tr("account.keys.status.expiring", { default: "Expires" })
          : tr("account.keys.status.expiringLabel", { default: "Expiring" })}
        {withTime && key.expiresAt ? <TimeAgo value={key.expiresAt} /> : null}
      </Badge>
    );
  }

  if (!withTime) {
    return (
      <Badge variant="tint" tone="success">
        {tr("account.keys.status.active", { default: "Active" })}
      </Badge>
    );
  }

  return key.expiresAt ? (
    <span className="text-muted-foreground text-xs">
      {tr("account.keys.status.expires", { default: "Expires" })}{" "}
      <TimeAgo value={key.expiresAt} />
    </span>
  ) : (
    <span className="text-muted-foreground text-xs">
      {tr("account.keys.status.noExpiry", { default: "No expiry" })}
    </span>
  );
};
