import type { ListApiKeyItem } from "alepha/api/keys";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { RefreshCw, Trash2 } from "lucide-react";

import { Badge } from "../core/Badge.tsx";
import { Button } from "../core/Button.tsx";
import TimeAgo from "../core/TimeAgo.tsx";
import { SettingsRow } from "../settings/SettingsRow.tsx";
import { ApiKeyScopeSummary } from "./ApiKeyScopeSummary.tsx";

export interface AccountKeysRowProps {
  apiKey: ListApiKeyItem;

  /**
   * Offered on a live or an expired key: rotating an expired key is how it
   * is renewed. Never on a revoked one.
   */
  onRotate: (apiKey: ListApiKeyItem) => void;

  /**
   * Offered on a live key only.
   */
  onRevoke: (apiKey: ListApiKeyItem) => void;
}

/**
 * One of your API keys: which one, how it has been used, where it is in its
 * life, and what may still be done with it.
 *
 * A revoked key keeps its row, dimmed, with its usage and no action left;
 * an expired key is dimmed too but keeps Rotate.
 */
export const AccountKeysRow = (props: AccountKeysRowProps) => {
  const dt = useInject(DateTimeProvider);
  const { tr } = useI18n();
  const key = props.apiKey;
  const dead = key.status === "revoked" || key.status === "expired";

  return (
    <SettingsRow
      label={key.name}
      className={dead ? "opacity-70" : undefined}
      description={
        (key.description ? `${key.description} · ` : "") +
        tr("account.keys.createdAt", {
          default: "…$1 · created $2",
          args: [key.tokenSuffix, dt.of(key.createdAt).fromNow()],
        }) +
        (key.lastUsedAt
          ? tr("account.keys.lastUsedAt", {
              default: " · last used $1",
              args: [dt.of(key.lastUsedAt).fromNow()],
            })
          : tr("account.keys.neverUsed", { default: " · never used" }))
      }
    >
      <div className="flex items-center gap-2">
        <ApiKeyScopeSummary permissions={key.permissions} />
        {key.status === "revoked" ? (
          <Badge variant="tint" tone="neutral">
            {tr("account.keys.status.revoked", { default: "Revoked" })}
            {key.revokedAt ? <TimeAgo value={key.revokedAt} /> : null}
          </Badge>
        ) : key.status === "expired" ? (
          <Badge variant="tint" tone="danger">
            {tr("account.keys.status.expired", { default: "Expired" })}
            {key.expiresAt ? <TimeAgo value={key.expiresAt} /> : null}
          </Badge>
        ) : key.status === "expiring" ? (
          <Badge variant="tint" tone="warning">
            {tr("account.keys.status.expiring", { default: "Expires" })}
            {key.expiresAt ? <TimeAgo value={key.expiresAt} /> : null}
          </Badge>
        ) : key.expiresAt ? (
          <span className="text-muted-foreground text-xs">
            {tr("account.keys.status.expires", { default: "Expires" })}{" "}
            <TimeAgo value={key.expiresAt} />
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">
            {tr("account.keys.status.noExpiry", { default: "No expiry" })}
          </span>
        )}

        {key.status === "revoked" ? null : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => props.onRotate(key)}
            aria-label={tr("account.keys.rotateAria", {
              default: "Rotate $1",
              args: [key.name],
            })}
          >
            <RefreshCw className="size-4" />
          </Button>
        )}

        {dead ? null : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => props.onRevoke(key)}
            aria-label={tr("account.keys.revokeAria", {
              default: "Revoke $1",
              args: [key.name],
            })}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </SettingsRow>
  );
};
