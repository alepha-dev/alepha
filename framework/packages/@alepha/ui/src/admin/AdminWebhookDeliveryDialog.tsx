import * as React from "react";

void React;

import type { AdminWebhookController } from "alepha/api/webhooks";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { RotateCw } from "lucide-react";
import { useRef } from "react";

import { Badge } from "../core/Badge.tsx";
import { Button } from "../core/Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../core/Dialog.tsx";
import { AdminJobsPayloadBody } from "./AdminJobsPayloadBody.tsx";

export interface AdminWebhookDeliveryDialogProps {
  /**
   * The delivery to show, or `undefined` when closed.
   */
  deliveryId?: string;
  onClose: () => void;
  /**
   * After a redelivery was queued: refresh the log it belongs to.
   */
  onRedelivered?: (deliveryId: string) => void;
  /**
   * Whether the endpoint is `active`. Redeliver is disabled, with the
   * reason, when it is not.
   */
  endpointActive?: boolean;
}

/**
 * One delivery, as the operator needs it when a customer says "we never got
 * it": the headers, the envelope, what the receiver answered, the error, and
 * a Redeliver button.
 *
 * A `pending` delivery is polled for a few seconds, so a test event shows
 * the receiver's answer without leaving the page.
 */
export const AdminWebhookDeliveryDialog = (
  props: AdminWebhookDeliveryDialogProps,
) => {
  const api = useClient<AdminWebhookController>();
  const { tr } = useI18n();
  const polls = useRef(0);
  // Whether the last read was still `pending`: read by `runEvery` on the
  // next render, so polling stops once the outcome is known.
  const pending = useRef(true);
  const id = props.deliveryId;

  const delivery = useQuery(
    {
      key: ["webhook-delivery", id],
      enabled: id !== undefined,
      handler: async () => {
        polls.current += 1;
        return api.getWebhookDelivery({ params: { id: id! } });
      },
      // Bounded: about ten seconds, then the dialog shows what it has.
      runEvery:
        pending.current && polls.current < 10 ? [1, "second"] : undefined,
    },
    [api, id],
  );
  const data = delivery.data?.id === id ? delivery.data : undefined;
  if (data) pending.current = data.status === "pending";

  const redeliver = useAction(
    {
      handler: async () => {
        const result = await api.redeliverWebhookDelivery({
          params: { id: id! },
        });
        props.onRedelivered?.(result.deliveryId);
        return result;
      },
      invalidates: [["webhook-deliveries"]],
    },
    [api, id, props.onRedelivered],
  );

  const active = props.endpointActive ?? true;

  return (
    <Dialog
      open={id !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          polls.current = 0;
          pending.current = true;
          props.onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {tr("admin.webhooks.deliveryTitle", { default: "Delivery" })}
            {data ? (
              <Badge variant="secondary" className="ms-2">
                {data.eventType}
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {data
              ? data.status === "pending"
                ? tr("admin.webhooks.deliveryPending", {
                    default: "Waiting for the receiver's answer.",
                  })
                : data.status === "delivered"
                  ? tr("admin.webhooks.deliveryDelivered", {
                      default: "Delivered.",
                    })
                  : tr("admin.webhooks.deliveryFailed", {
                      default: "Failed.",
                    })
              : null}
          </DialogDescription>
        </DialogHeader>
        {data ? (
          <div
            className="flex flex-col gap-3 text-sm"
            data-testid="webhook-delivery"
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">webhook-id</dt>
              <dd className="font-mono text-xs">{data.eventId}</dd>
              <dt className="text-muted-foreground">webhook-timestamp</dt>
              <dd className="text-muted-foreground text-xs">
                {tr("admin.webhooks.perAttempt", {
                  default: "Set on each attempt",
                })}
              </dd>
              <dt className="text-muted-foreground">webhook-signature</dt>
              <dd className="text-muted-foreground text-xs">
                {tr("admin.webhooks.perAttempt", {
                  default: "Set on each attempt",
                })}
              </dd>
              <dt className="text-muted-foreground">
                {tr("admin.webhooks.host", { default: "Host" })}
              </dt>
              <dd className="font-mono text-xs">{data.host}</dd>
              <dt className="text-muted-foreground">
                {tr("admin.webhooks.colHttpStatus", { default: "HTTP status" })}
              </dt>
              <dd data-testid="webhook-delivery-status">
                {data.responseStatus ?? ""}
              </dd>
              <dt className="text-muted-foreground">
                {tr("admin.webhooks.colAttempts", { default: "Attempts" })}
              </dt>
              <dd>{data.attempt}</dd>
            </dl>
            <AdminJobsPayloadBody payload={data.payload} />
            {data.responseExcerpt ? (
              <pre className="bg-muted max-h-40 overflow-auto rounded-md p-3 font-mono text-xs">
                {data.responseExcerpt}
              </pre>
            ) : null}
            {data.error ? (
              <p className="text-destructive text-xs">{data.error}</p>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outlined"
            disabled={!active || redeliver.loading}
            title={
              active
                ? undefined
                : tr("admin.webhooks.redeliverInactive", {
                    default: "The endpoint is not active",
                  })
            }
            loading={redeliver.loading}
            onClick={() => void redeliver.run()}
          >
            <RotateCw className="size-4" />
            {tr("admin.webhooks.redeliver", { default: "Redeliver" })}
          </Button>
          <Button
            type="button"
            onClick={() => {
              polls.current = 0;
              pending.current = true;
              props.onClose();
            }}
          >
            {tr("admin.webhooks.close", { default: "Close" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
