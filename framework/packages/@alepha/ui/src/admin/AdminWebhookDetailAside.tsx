import * as React from "react";

void React;

import type { WebhookEndpointResource } from "alepha/api/webhooks";
import { useI18n } from "alepha/react/i18n";

import { DetailAside, type DetailAsideRow } from "../shell/DetailAside.tsx";
import { AdminWebhooksStatusBadge } from "./AdminWebhooksStatusBadge.tsx";

export interface AdminWebhookDetailAsideProps {
  endpoint: WebhookEndpointResource;
}

/**
 * The facts of an endpoint: its status, its secret's prefix, and the
 * previous secret's end while a rotation overlaps.
 */
export const AdminWebhookDetailAside = (
  props: AdminWebhookDetailAsideProps,
) => {
  const { l, tr } = useI18n();
  const endpoint = props.endpoint;
  let host = endpoint.url;
  try {
    host = new URL(endpoint.url).host;
  } catch {
    // Shown whole.
  }

  const rows: DetailAsideRow[] = [
    {
      label: tr("admin.webhooks.colStatus", { default: "Status" }),
      value: <AdminWebhooksStatusBadge endpoint={endpoint} />,
    },
    {
      label: tr("admin.webhooks.secretPrefix", { default: "Signing secret" }),
      value: <code className="text-xs">{endpoint.secretPrefix}...</code>,
    },
    ...(endpoint.hasPreviousSecret && endpoint.previousSecretExpiresAt
      ? [
          {
            label: tr("admin.webhooks.previousSecret", {
              default: "Previous secret valid until",
            }),
            value: l(endpoint.previousSecretExpiresAt, { date: "lll" }),
          },
        ]
      : []),
    ...(endpoint.scope
      ? [
          {
            label: tr("admin.webhooks.scope", { default: "Scope" }),
            value: <code className="text-xs">{endpoint.scope}</code>,
          },
        ]
      : []),
    {
      label: tr("admin.webhooks.colLastSuccess", { default: "Last success" }),
      value: endpoint.lastSuccessAt
        ? l(endpoint.lastSuccessAt, { date: "lll" })
        : "",
    },
    ...(endpoint.failingSince
      ? [
          {
            label: tr("admin.webhooks.colFailingSince", {
              default: "Failing since",
            }),
            value: l(endpoint.failingSince, { date: "lll" }),
          },
        ]
      : []),
  ];

  return <DetailAside title={host} avatar={false} rows={rows} />;
};
