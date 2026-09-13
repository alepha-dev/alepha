import type { ListApiKeyItem } from "alepha/api/keys";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { RefreshCw, Trash2 } from "lucide-react";

import { Button } from "../core/Button.tsx";
import { SettingsRow } from "../settings/SettingsRow.tsx";
import { ApiKeyScopeSummary } from "./ApiKeyScopeSummary.tsx";
import { ApiKeyStatusBadge } from "./ApiKeyStatusBadge.tsx";

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
        <ApiKeyStatusBadge apiKey={key} />

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
