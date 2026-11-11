import * as React from "react";

void React;

import type { WebhookEndpointResource } from "alepha/api/webhooks";
import { useI18n } from "alepha/react/i18n";
import { CircleCheck, CirclePause, CircleX } from "lucide-react";

import { Badge } from "../core/Badge.tsx";

export interface AdminWebhooksStatusBadgeProps {
  endpoint: Pick<WebhookEndpointResource, "status" | "disabledReason">;
}

/**
 * A webhook endpoint's status as a tinted chip. A disabled endpoint names
 * why in its title: the receiver said `410 Gone`, it kept failing, or its
 * secret no longer decrypts.
 */
export const AdminWebhooksStatusBadge = (
  props: AdminWebhooksStatusBadgeProps,
) => {
  const { tr } = useI18n();
  const { status, disabledReason } = props.endpoint;
  if (status === "active") {
    return (
      <Badge variant="tint" tone="success">
        <CircleCheck className="size-3" />
        {tr("admin.webhooks.status.active", { default: "Active" })}
      </Badge>
    );
  }
  if (status === "paused") {
    return (
      <Badge variant="tint" tone="warning">
        <CirclePause className="size-3" />
        {tr("admin.webhooks.status.paused", { default: "Paused" })}
      </Badge>
    );
  }
  const reason =
    disabledReason === "gone"
      ? tr("admin.webhooks.reason.gone", {
          default: "The receiver answered 410 Gone",
        })
      : disabledReason === "secret"
        ? tr("admin.webhooks.reason.secret", {
            default: "Its secret no longer decrypts: rotate it, then enable",
          })
        : tr("admin.webhooks.reason.failing", {
            default: "It kept failing for days",
          });
  return (
    <Badge variant="tint" tone="danger" title={reason}>
      <CircleX className="size-3" />
      {tr("admin.webhooks.status.disabled", { default: "Disabled" })}
    </Badge>
  );
};
